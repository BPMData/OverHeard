import { describe, expect, it, vi } from 'vitest';
import { CHROME_PACKS_PAGE, createChromePackStorageCategory } from './packStorage';

describe('Chrome language packs storage', () => {
  it('lists installed packs but offers no delete, and says how to remove them in Chrome', async () => {
    const availability = vi.fn(async (code: string) => (code === 'es' || code === 'vi' ? 'available' : 'downloadable'));
    const category = createChromePackStorageCategory(availability as never, () => true);
    const items = await category.list();
    expect(items).toEqual([
      { id: 'es', label: 'English ↔ Spanish', bytes: null, removable: false },
      { id: 'vi', label: 'English ↔ Vietnamese', bytes: null, removable: false },
    ]);
    expect(availability).toHaveBeenCalledWith('es', 'en');
    // Chrome can't delete packs for a website: no fake delete buttons
    expect(category.removeAll).toBeUndefined();
    expect(category.removeItem).toBeUndefined();
    expect(category.cannotRemoveNote).toContain(CHROME_PACKS_PAGE);
  });

  it('lists nothing without the Translator API', async () => {
    const availability = vi.fn();
    const category = createChromePackStorageCategory(availability as never, () => false);
    expect(await category.list()).toEqual([]);
    expect(availability).not.toHaveBeenCalled();
  });

  it('treats a pack check that never answers as not installed', async () => {
    vi.useFakeTimers();
    try {
      const availability = vi.fn((code: string) =>
        code === 'es' ? Promise.resolve('available') : new Promise<never>(() => undefined)
      );
      const listing = createChromePackStorageCategory(availability as never, () => true).list();
      await vi.advanceTimersByTimeAsync(3000);
      expect((await listing).map((item) => item.id)).toEqual(['es']);
    } finally {
      vi.useRealTimers();
    }
  });
});
