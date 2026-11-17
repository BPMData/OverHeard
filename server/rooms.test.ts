import express from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { createRoomRouter } from './rooms';
import { emptyLecture } from '../src/rooms/protocol';

let server: Server;
let service: ReturnType<typeof createRoomRouter>;
let base: string;
let clock = 1000;
const streams: AbortController[] = [];
beforeEach(async () => {
  clock = 1000;
  service = createRoomRouter({ now: () => clock });
  const app = express(); app.use('/api/rooms', service.router);
  server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
    instance.once('error', reject);
  });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/rooms`;
});
afterEach(async () => {
  for (const controller of streams.splice(0)) controller.abort();
  service.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});
const request = (path: string, method = 'GET', body?: unknown, token?: string) => fetch(base + path, {
  method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const create = async (code = 'science-101', pin = '1234') => (await request('', 'POST', { code, pin })).json();
const patch = (text = 'Gravity pulls objects down.') => ({ ...emptyLecture(), selectedLangs: ['es'],
  entries: [{ id: 'one', timestamp: 1000, english: text, translations: { es: 'La gravedad atrae los objetos.' }, failedLangs: {} }], removedIds: [],
  isListening: true, interim: 'Our next topic', liveTranslations: { es: 'Nuestro siguiente tema' } });

async function stream(code: string) {
  const controller = new AbortController(); streams.push(controller);
  const response = await fetch(`${base}/${code}/events`, { signal: controller.signal });
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder(); let buffer = '';
  return async () => {
    while (true) {
      const end = buffer.indexOf('\n\n');
      if (end >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const event = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (event && data) return { event, data: JSON.parse(data) };
      } else {
        const { value, done } = await reader.read();
        if (done) throw new Error('Unexpected closed stream');
        buffer += decoder.decode(value, { stream: true });
      }
    }
  };
}

describe('live classroom rooms', () => {
  it('requires a valid PIN, issues private teacher credentials, and rejects unauthorized writes or collisions', async () => {
    expect((await request('', 'POST', { code: 'science-101' })).status).toBe(400);
    expect((await request('', 'POST', { code: 'science-101', pin: '12' })).status).toBe(400);
    const { code, token } = await create();
    expect(token).toHaveLength(64);
    expect((await request('', 'POST', { code, pin: '1234' })).status).toBe(409);
    expect((await request(`/${code}`, 'PUT', patch())).status).toBe(403);
    expect((await request(`/${code}`, 'DELETE', undefined, 'wrong')).status).toBe(403);
    expect((await request(`/${code}`, 'PUT', patch(), token)).status).toBe(200);
    expect(JSON.stringify(await (await request(`/${code}`)).json())).not.toContain(token);
    expect((await request('/missing-room')).status).toBe(404);
  });
  it('streams interim text and translations to two students, catches late joins up, and ends the room', async () => {
    const { code, token } = await create();
    const first = await stream(code); const second = await stream(code);
    expect((await first()).data.entries).toEqual([]); await second();
    await request(`/${code}`, 'PUT', patch(), token);
    for (const next of [first, second]) {
      const event = await next(); expect(event.event).toBe('patch');
      expect(event.data.liveTranslations.es).toBe('Nuestro siguiente tema');
      expect(event.data.entries[0].translations.es).toBe('La gravedad atrae los objetos.');
      expect(JSON.stringify(event)).not.toContain(token);
    }
    const late = await stream(code);
    expect((await late()).data.entries).toHaveLength(1);
    await request(`/${code}`, 'DELETE', undefined, token);
    expect((await first()).data.ended).toBe(true);
    expect((await request(`/${code}`, 'PUT', patch(), token)).status).toBe(410);
  });
  it('rejects malformed updates atomically and supports clear/import replacement', async () => {
    const { code, token } = await create();
    await request(`/${code}`, 'PUT', patch(), token);
    expect((await request(`/${code}`, 'PUT', { ...patch(), entries: [{ ...patch().entries[0], english: 'x'.repeat(501) }] }, token)).status).toBe(400);
    let next = await stream(code); expect((await next()).data.entries[0].english).toBe('Gravity pulls objects down.');
    await request(`/${code}`, 'PUT', { ...patch('Imported lesson'), reset: true, entries: [{ ...patch('Imported lesson').entries[0], id: 'imported' }] }, token);
    next = await stream(code); expect((await next()).data.entries.map((row: { id: string }) => row.id)).toEqual(['imported']);
    await request(`/${code}`, 'PUT', { ...emptyLecture(), entries: [], removedIds: ['imported'] }, token);
    next = await stream(code); expect((await next()).data.entries).toEqual([]);
  });
  it('marks disconnected teachers offline, resumes on publish, and expires idle rooms', async () => {
    const { code, token } = await create();
    await request(`/${code}`, 'PUT', patch(), token);
    const next = await stream(code); await next();
    clock += 36_000; service.sweep();
    expect((await next()).data.teacherOnline).toBe(false);
    await request(`/${code}`, 'PUT', { ...patch(), entries: [] }, token);
    expect((await next()).data.teacherOnline).toBe(true);
    clock += 9 * 60 * 60_000;
    expect((await request(`/${code}`)).status).toBe(404);
    expect((await request(`/${code}/events`)).status).toBe(404);
    service.sweep();
    expect((await next()).event).toBe('expired');
    expect((await request(`/${code}`)).status).toBe(404);
  });
  it('lets a teacher rejoin an active room with matching PIN, rotates token, and preserves student streams', async () => {
    const { code, token: originalToken } = await create('bio-202', '9876');
    await request(`/${code}`, 'PUT', patch('Cell division begins.'), originalToken);
    clock += 36_000; service.sweep();
    const student = await stream(code);
    const initial = await student();
    expect(initial.data.teacherOnline).toBe(false);
    expect(initial.data.entries).toHaveLength(1);

    expect((await request('/missing-room/rejoin', 'POST', { pin: '9876' })).status).toBe(404);
    expect((await request(`/${code}/rejoin`, 'POST', { pin: '0000' })).status).toBe(403);

    const rejoinRes = await request(`/${code}/rejoin`, 'POST', { pin: '9876' });
    expect(rejoinRes.status).toBe(200);
    const rejoined = await rejoinRes.json();
    expect(rejoined.code).toBe(code);
    expect(rejoined.token).toHaveLength(64);
    expect(rejoined.token).not.toBe(originalToken);
    expect(rejoined.snapshot.entries[0].english).toBe('Cell division begins.');
    expect(rejoined.snapshot.teacherOnline).toBe(true);
    expect(JSON.stringify(rejoined)).not.toContain('9876');

    const updated = await student();
    expect(updated.event).toBe('snapshot');
    expect(updated.data.teacherOnline).toBe(true);

    expect((await request(`/${code}`, 'PUT', patch('Old tab write'), originalToken)).status).toBe(403);
    expect((await request(`/${code}`, 'PUT', patch('Resumed lesson'), rejoined.token)).status).toBe(200);
    expect((await student()).event).toBe('patch');

    await request(`/${code}`, 'DELETE', undefined, rejoined.token);
    expect((await student()).data.ended).toBe(true);
    expect((await request(`/${code}/rejoin`, 'POST', { pin: '0000' })).status).toBe(403);

    const restartedRes = await request(`/${code}/rejoin`, 'POST', { pin: '9876' });
    expect(restartedRes.status).toBe(200);
    const restarted = await restartedRes.json();
    expect(restarted.snapshot.ended).toBe(false);
    expect(restarted.snapshot.teacherOnline).toBe(true);
    const wakeUp = await student();
    expect(wakeUp.event).toBe('snapshot');
    expect(wakeUp.data.ended).toBe(false);
    expect(wakeUp.data.teacherOnline).toBe(true);
    expect((await request(`/${code}`, 'PUT', patch('After restart'), rejoined.token)).status).toBe(403);
    expect((await request(`/${code}`, 'PUT', patch('After restart'), restarted.token)).status).toBe(200);
  });
});
