// Downloaded things the app keeps on this device (reader voices, language packs, and later
// MMS voices or Bergamot translation models). Each kind registers a `StorageCategory` here, and
// Settings → "Space used on this device" lists them all, with sizes and delete buttons.
//
// To add a new kind of download: build a StorageCategory (see src/tts/voiceStorage.ts) and
// call registerStorageCategory() once at module load. Nothing in the Settings UI needs to change.

export interface StoredItem {
  id: string;
  /** Plain name a teacher understands, e.g. "Spanish · Claude (Female · MX)" */
  label: string;
  /** Bytes on disk, or null when the platform doesn't say */
  bytes: number | null;
  /** True when `bytes` is an estimate rather than a measurement */
  approximate?: boolean;
  /** False when this one item can't be deleted on its own (it may still go with "delete all") */
  removable: boolean;
}

export interface StorageCategory {
  id: string;
  /** Section title, e.g. "Downloaded voices" */
  title: string;
  /** One sentence on what these are and what happens without them */
  description: string;
  /** What is stored now. Should resolve to [] (not reject) when nothing is stored. */
  list: () => Promise<StoredItem[]>;
  /** Delete one item. Omit when items can't be deleted one at a time. */
  removeItem?: (id: string) => Promise<void>;
  /** Delete everything in this category. Omit when the app can't delete these. */
  removeAll?: () => Promise<void>;
  /** Shown instead of a delete button when the app can't delete these */
  cannotRemoveNote?: string;
  /** Rest of the "Free up space: …" button, e.g. "delete all downloaded voices" */
  removeAllLabel?: string;
  /** Confirmation text on what happens afterwards, e.g. that they must be downloaded again */
  afterRemoveNote?: string;
  /** The same for deleting one item */
  afterRemoveItemNote?: string;
}

const categories = new Map<string, StorageCategory>();
const listeners = new Set<() => void>();

/** Add (or replace, by id) a kind of download. Returns a function that removes it again. */
export function registerStorageCategory(category: StorageCategory): () => void {
  categories.set(category.id, category);
  notifyStorageChanged();
  return () => {
    if (categories.get(category.id) === category) {
      categories.delete(category.id);
      notifyStorageChanged();
    }
  };
}

export function getStorageCategories(): StorageCategory[] {
  return [...categories.values()];
}

/** Tell open storage views to measure again (after a download finishes, for example). */
export function notifyStorageChanged(): void {
  for (const listener of listeners) listener();
}

export function subscribeStorageChanges(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sum of known sizes. `approximate` is true if any part is estimated or unknown. */
export function totalBytes(items: readonly StoredItem[]): { bytes: number; approximate: boolean; unknown: number } {
  let bytes = 0;
  let approximate = false;
  let unknown = 0;
  for (const item of items) {
    if (item.bytes === null) {
      unknown += 1;
      continue;
    }
    bytes += item.bytes;
    if (item.approximate) approximate = true;
  }
  return { bytes, approximate, unknown };
}

const MB = 1024 * 1024;

/** "63 MB", "1.2 GB", "850 KB". Uses binary units, like the OS file manager on Windows/ChromeOS. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * MB) {
    const mb = bytes / MB;
    return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
  }
  return `${(bytes / (1024 * MB)).toFixed(1).replace(/\.0$/, '')} GB`;
}

/** What the browser says this site uses and may use in total, or null when it can't say. */
export async function estimateSiteStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    return { usage, quota };
  } catch {
    return null;
  }
}
