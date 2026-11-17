// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ROOM_HISTORY,
  ROOM_HISTORY_STORAGE_KEY,
  checkRoomLiveStatus,
  clearRoomHistory,
  formatRoomAge,
  loadRoomHistory,
  recordRoomHistory,
} from './roomHistory';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('roomHistory', () => {
  it('records, deduplicates, sorts, and caps room history entries', () => {
    const first = recordRoomHistory('  Bio-101 ', 1000);
    expect(first).toEqual([{ code: 'bio-101', createdAt: 1000, lastUsedAt: 1000 }]);

    recordRoomHistory('chem-202', 2000);
    const updated = recordRoomHistory('BIO-101', 3000);
    expect(updated).toEqual([
      { code: 'bio-101', createdAt: 1000, lastUsedAt: 3000 },
      { code: 'chem-202', createdAt: 2000, lastUsedAt: 2000 },
    ]);

    // Ignores invalid room codes
    expect(recordRoomHistory('x', 4000)).toEqual(updated);

    // Caps at MAX_ROOM_HISTORY
    for (let i = 0; i < MAX_ROOM_HISTORY + 5; i += 1) {
      recordRoomHistory(`room-${i}`, 5000 + i);
    }
    const capped = loadRoomHistory();
    expect(capped).toHaveLength(MAX_ROOM_HISTORY);
    expect(capped[0].code).toBe(`room-${MAX_ROOM_HISTORY + 4}`);

    clearRoomHistory();
    expect(loadRoomHistory()).toEqual([]);
  });

  it('sanitizes malformed localStorage entries', () => {
    localStorage.setItem(ROOM_HISTORY_STORAGE_KEY, 'not-json');
    expect(loadRoomHistory()).toEqual([]);

    localStorage.setItem(
      ROOM_HISTORY_STORAGE_KEY,
      JSON.stringify([
        null,
        { code: '!!invalid!!' },
        { code: 'x' },
        { code: 'Valid-1', createdAt: 100, lastUsedAt: 500 },
        { code: 'valid-1', createdAt: 200, lastUsedAt: 900 },
      ]),
    );
    expect(loadRoomHistory()).toEqual([{ code: 'valid-1', createdAt: 100, lastUsedAt: 900 }]);
  });

  it('checks room live status from the server endpoint', async () => {
    expect(await checkRoomLiveStatus('x')).toBe('expired');

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/live-1')) return new Response(JSON.stringify({ ended: false }), { status: 200 });
        if (url.endsWith('/ended-1')) return new Response(JSON.stringify({ ended: true }), { status: 200 });
        if (url.endsWith('/gone-1')) return new Response(JSON.stringify({ error: 'Not found' }), { status: 404 });
        if (url.endsWith('/err-1')) return new Response('bad gateway', { status: 502 });
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(await checkRoomLiveStatus('live-1')).toBe('live');
    expect(await checkRoomLiveStatus('ended-1')).toBe('ended');
    expect(await checkRoomLiveStatus('gone-1')).toBe('expired');
    expect(await checkRoomLiveStatus('err-1')).toBe('unknown');
    expect(await checkRoomLiveStatus('net-1')).toBe('unknown');
  });

  it('formats relative room ages cleanly', () => {
    const now = 1_700_000_000_000;
    expect(formatRoomAge(now - 10_000, now)).toBe('Just now');
    expect(formatRoomAge(now - 5 * 60_000, now)).toBe('5m ago');
    expect(formatRoomAge(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(formatRoomAge(now - 2 * 86_400_000, now)).toBe('2d ago');
    expect(formatRoomAge(now - 10 * 86_400_000, now)).toBe(new Date(now - 10 * 86_400_000).toLocaleDateString());
  });
});
