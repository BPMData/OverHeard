import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estimateSiteStorage,
  formatBytes,
  getStorageCategories,
  registerStorageCategory,
  subscribeStorageChanges,
  totalBytes,
  type StorageCategory,
} from './registry';

const category = (id: string): StorageCategory => ({
  id,
  title: id,
  description: '',
  list: async () => [],
});

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

describe('storage registry', () => {
  it('lets new kinds of downloads register and unregister, and tells listeners', () => {
    const listener = vi.fn();
    cleanups.push(subscribeStorageChanges(listener));
    const before = getStorageCategories().length;
    const unregister = registerStorageCategory(category('mms-voices'));
    expect(getStorageCategories().map((c) => c.id)).toContain('mms-voices');
    expect(listener).toHaveBeenCalledTimes(1);

    // Registering the same id again replaces it instead of listing it twice
    const replacement = category('mms-voices');
    cleanups.push(registerStorageCategory(replacement));
    expect(getStorageCategories().filter((c) => c.id === 'mms-voices')).toEqual([replacement]);
    // The old registration's cleanup doesn't remove the replacement
    unregister();
    expect(getStorageCategories()).toHaveLength(before + 1);
  });

  it('adds up sizes, flagging estimates and items with no size', () => {
    expect(
      totalBytes([
        { id: 'a', label: 'a', bytes: 100, removable: true },
        { id: 'b', label: 'b', bytes: 50, approximate: true, removable: true },
        { id: 'c', label: 'c', bytes: null, removable: false },
      ]),
    ).toEqual({ bytes: 150, approximate: true, unknown: 1 });
    expect(totalBytes([])).toEqual({ bytes: 0, approximate: false, unknown: 0 });
  });

  it('formats sizes the way a teacher reads them', () => {
    expect(formatBytes(0)).toBe('0 MB');
    expect(formatBytes(500)).toBe('1 KB');
    expect(formatBytes(850 * 1024)).toBe('850 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(63_221_984)).toBe('60 MB');
    expect(formatBytes(1.2 * 1024 ** 3)).toBe('1.2 GB');
  });

  it('returns null when the browser cannot estimate storage', async () => {
    vi.stubGlobal('navigator', {});
    expect(await estimateSiteStorage()).toBeNull();
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 10, quota: 100 }) } });
    expect(await estimateSiteStorage()).toEqual({ usage: 10, quota: 100 });
  });
});
