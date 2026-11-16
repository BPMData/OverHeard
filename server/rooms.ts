import { randomBytes, timingSafeEqual } from 'node:crypto';
import express, { type Response } from 'express';
import { applyPatch, emptyLecture, MAX_ROOM_FILE_BYTES, normalizeRoomCode, parsePatch, validRoomCode,
  type RoomSnapshot } from '../src/rooms/protocol.ts';
import { createRateLimiter } from './rateLimit.ts';

interface Room {
  token: string;
  snapshot: RoomSnapshot;
  touchedAt: number;
  publishedAt: number;
  clients: Set<Response>;
}

// Live transport only. A restart discards rooms; local JSON exports are the durable copy.
// Run one server instance until a shared room store/pub-sub is introduced.
export function createRoomRouter({ now = Date.now, maxRooms = 100 } = {}) {
  const router = express.Router();
  const rooms = new Map<string, Room>();
  const creates = createRateLimiter(20, 60_000, now);
  const joins = createRateLimiter(600, 60_000, now);
  const publishes = createRateLimiter(600, 60_000, now);
  const send = (res: Response, event: string, value: unknown) => {
    if (res.destroyed) return;
    // Disconnect slow readers instead of retaining unbounded caption buffers.
    if (res.writableLength > MAX_ROOM_FILE_BYTES * 2) { res.end(); return; }
    res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
  };
  const broadcast = (room: Room, event: string, value: unknown) => {
    for (const client of room.clients) send(client, event, value);
  };
  const sweep = () => {
    for (const [code, room] of rooms) {
      if (now() - room.touchedAt > (room.snapshot.ended ? 60 * 60_000 : 8 * 60 * 60_000)) {
        for (const client of room.clients) { send(client, 'expired', {}); client.end(); }
        rooms.delete(code);
      } else {
        if (room.snapshot.teacherOnline && now() - room.publishedAt > 35_000) {
          room.snapshot = { ...room.snapshot, teacherOnline: false, isListening: false,
            interim: '', liveTranslations: {}, revision: room.snapshot.revision + 1 };
          broadcast(room, 'snapshot', room.snapshot);
        }
        for (const client of room.clients) client.write(': heartbeat\n\n');
      }
    }
    creates.prune(); joins.prune(); publishes.prune();
  };
  const timer = setInterval(sweep, 10_000);
  timer.unref();

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.post('/', express.json({ limit: '1kb' }), (req, res) => {
    sweep();
    if (creates.isLimited(req.ip || 'unknown')) { res.status(429).json({ error: 'Too many rooms created. Try again in a minute.' }); return; }
    if (rooms.size >= maxRooms) { res.status(503).json({ error: 'Room capacity reached. Please try again later.' }); return; }
    if (req.body?.code !== undefined && typeof req.body.code !== 'string') { res.status(400).json({ error: 'Invalid room code.' }); return; }
    const code = normalizeRoomCode(req.body?.code || randomBytes(4).toString('hex'));
    if (!validRoomCode(code)) { res.status(400).json({ error: 'Use 3–40 letters, numbers, or hyphens for the room code.' }); return; }
    if (rooms.has(code)) { res.status(409).json({ error: 'That room code is already in use. Choose another.' }); return; }
    const token = randomBytes(32).toString('hex');
    rooms.set(code, { token, touchedAt: now(), publishedAt: now(), clients: new Set(),
      snapshot: { ...emptyLecture(), revision: 0, teacherOnline: true, ended: false } });
    res.status(201).json({ code, token });
  });

  router.get('/:code/events', (req, res) => {
    const room = rooms.get(normalizeRoomCode(req.params.code));
    if (!room) { res.status(404).json({ error: 'Room not found. Check the code or ask your teacher for a new link.' }); return; }
    if (room.clients.size >= 200 || joins.isLimited(req.ip || 'unknown')) { res.status(429).json({ error: 'Room connection limit reached.' }); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 2000\n\n');
    room.clients.add(res);
    res.on('close', () => room.clients.delete(res));
    send(res, 'snapshot', room.snapshot);
  });

  router.get('/:code', (req, res) => {
    const room = rooms.get(normalizeRoomCode(req.params.code));
    if (!room) { res.status(404).json({ error: 'Room not found. Check the code or ask your teacher for a new link.' }); return; }
    res.json({ ended: room.snapshot.ended });
  });

  router.use('/:code', (req, res, next) => {
    const room = rooms.get(normalizeRoomCode(req.params.code));
    if (!room) { res.status(404).json({ error: 'This room is no longer available. Create a new room and share its link.' }); return; }
    const token = req.get('authorization')?.replace(/^Bearer /, '') ?? '';
    const expected = Buffer.from(room.token);
    const actual = Buffer.from(token);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.status(403).json({ error: 'Only the teacher can change this room.' }); return;
    }
    res.locals.room = room;
    next();
  });
  router.put('/:code', express.json({ limit: MAX_ROOM_FILE_BYTES }), (req, res) => {
    const room: Room = res.locals.room;
    if (room.snapshot.ended) { res.status(410).json({ error: 'This room has ended. Create a new room to continue.' }); return; }
    if (publishes.isLimited(room.token)) { res.status(429).json({ error: 'Too many updates. Reconnecting shortly.' }); return; }
    try {
      const patch = parsePatch(req.body);
      const next = { ...applyPatch(room.snapshot, patch), revision: room.snapshot.revision + 1, teacherOnline: true };
      if (Buffer.byteLength(JSON.stringify(next)) > MAX_ROOM_FILE_BYTES) throw new Error('Room is full. Export and clear the transcript to continue.');
      room.snapshot = next;
      room.touchedAt = room.publishedAt = now();
      broadcast(room, 'patch', { ...patch, revision: next.revision, teacherOnline: true, ended: false });
      res.json({ revision: next.revision });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Invalid room update.' });
    }
  });
  router.delete('/:code', (_req, res) => {
    const room: Room = res.locals.room;
    room.snapshot = { ...room.snapshot, ended: true, isListening: false, interim: '',
      liveTranslations: {}, teacherOnline: false, revision: room.snapshot.revision + 1 };
    room.touchedAt = now();
    broadcast(room, 'snapshot', room.snapshot);
    res.json({ ok: true });
  });

  return { router, sweep, close: () => { clearInterval(timer); for (const room of rooms.values()) for (const client of room.clients) client.end(); rooms.clear(); } };
}
