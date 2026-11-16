import { describe, expect, it } from 'vitest';
import { applyPatch, emptyLecture, parsePatch, parseRoomJson, roomJson } from './protocol';

const entry = { id: 'one', timestamp: 100, english: 'Hello', translations: { es: 'Hola' }, failedLangs: {} };
describe('portable lecture data', () => {
  it('round trips English, translations, timestamps and languages without room credentials', () => {
    const state = { ...emptyLecture(), entries: [entry], selectedLangs: ['es' as const], token: 'secret', code: 'classroom' };
    const json = roomJson(state);
    expect(json).not.toContain('secret');
    expect(json).not.toContain('classroom');
    expect(parseRoomJson(json)).toEqual({ entries: [entry], selectedLangs: ['es'] });
  });
  it('rejects wrong formats, duplicate IDs, invalid languages and oversized lines', () => {
    expect(() => parseRoomJson('{}')).toThrow();
    expect(() => parseRoomJson(roomJson({ entries: [entry, entry], selectedLangs: [] }))).toThrow();
    expect(() => parseRoomJson(JSON.stringify({ format: 'overheard-lecture', version: 1, entries: [], selectedLangs: ['xx'] }))).toThrow();
    expect(() => parseRoomJson(roomJson({ entries: [{ ...entry, english: 'x'.repeat(501) }], selectedLangs: [] }))).toThrow();
  });
  it('applies ordered updates, removal and resets without losing existing translations', () => {
    const start = { ...emptyLecture(), entries: [entry] };
    const patch = parsePatch({ ...emptyLecture(), entries: [{ ...entry, id: 'two' }], removedIds: [] });
    expect(applyPatch(start, patch).entries.map(row => row.id)).toEqual(['one', 'two']);
    expect(applyPatch(start, { ...patch, reset: true }).entries.map(row => row.id)).toEqual(['two']);
    expect(applyPatch(start, { ...patch, entries: [], removedIds: ['one'] }).entries).toEqual([]);
    expect(() => parsePatch({ ...patch, entries: [{ ...entry, timestamp: 1e99 }] })).toThrow();
  });
});
