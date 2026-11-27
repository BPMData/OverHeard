import { describe, expect, it } from 'vitest';
import {
  applyPatch,
  emptyLecture,
  MAX_ROOM_ENTRIES,
  MAX_ROOM_FILE_BYTES,
  parsePatch,
  parseRoomJson,
  roomJson,
} from './protocol';

const entry = { id: 'one', timestamp: 100, english: 'Hello', translations: { es: 'Hola' }, failedLangs: {} };
describe('portable lecture data', () => {
  it('round trips English, translations, timestamps and languages without room credentials', () => {
    const state = {
      ...emptyLecture(),
      entries: [entry],
      selectedLangs: ['es' as const],
      token: 'secret',
      code: 'classroom',
    };
    const json = roomJson(state);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('classroom');
    expect(parseRoomJson(json)).toEqual({ entries: [entry], selectedLangs: ['es'] });
  });
  it('reopens a 2,001-line file while live rooms still stop at 2,000', () => {
    const entries = Array.from({ length: MAX_ROOM_ENTRIES + 1 }, (_, i) => ({ ...entry, id: String(i) }));
    const file = { entries, selectedLangs: ['es' as const] };
    expect(parseRoomJson(roomJson(file))).toEqual(file);

    const patch = { ...emptyLecture(), entries, removedIds: [] };
    expect(() => parsePatch(patch)).toThrow(/2000/);
    const last = entries.at(-1)!;
    const fullRoom = applyPatch(emptyLecture(), parsePatch({ ...patch, entries: entries.slice(0, -1) }));
    expect(() => applyPatch(fullRoom, parsePatch({ ...patch, entries: [last] }))).toThrow(/2000/);
  });
  it('uses compact JSON when indentation alone exceeds the file limit and checks UTF-8 bytes', () => {
    const entries = Array.from({ length: 5800 }, (_, i) => ({
      ...entry,
      id: String(i),
      english: '語'.repeat(440),
    }));
    const file = { entries, selectedLangs: ['es' as const] };
    expect(new TextEncoder().encode(JSON.stringify(file, null, 2)).length).toBeGreaterThan(MAX_ROOM_FILE_BYTES);
    const json = roomJson(file);
    expect(parseRoomJson(json).entries).toHaveLength(entries.length);
    const oversized = { ...file, entries: entries.map((e) => ({ ...e, english: '語'.repeat(500) })) };
    expect(() => roomJson(oversized)).toThrow(/8 MB/);
    expect(() => parseRoomJson(JSON.stringify(oversized))).toThrow(/8 MB/);
  });
  it('rejects wrong formats, duplicate IDs, invalid languages and oversized lines', () => {
    expect(() => parseRoomJson('{}')).toThrow();
    expect(() => parseRoomJson(roomJson({ entries: [entry, entry], selectedLangs: [] }))).toThrow();
    expect(() =>
      parseRoomJson(JSON.stringify({ format: 'overheard-lecture', version: 1, entries: [], selectedLangs: ['xx'] }))
    ).toThrow();
    expect(() =>
      parseRoomJson(roomJson({ entries: [{ ...entry, english: 'x'.repeat(501) }], selectedLangs: [] }))
    ).toThrow();
  });
  it('applies ordered updates, removal and resets without losing existing translations', () => {
    const start = { ...emptyLecture(), entries: [entry] };
    const patch = parsePatch({ ...emptyLecture(), entries: [{ ...entry, id: 'two' }], removedIds: [] });
    expect(applyPatch(start, patch).entries.map((row) => row.id)).toEqual(['one', 'two']);
    expect(applyPatch(start, { ...patch, reset: true }).entries.map((row) => row.id)).toEqual(['two']);
    expect(applyPatch(start, { ...patch, entries: [], removedIds: ['one'] }).entries).toEqual([]);
    expect(() => parsePatch({ ...patch, entries: [{ ...entry, timestamp: 1e99 }] })).toThrow();
  });
});
