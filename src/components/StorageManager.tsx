import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, Copy, HardDrive, Trash2 } from 'lucide-react';
import {
  estimateSiteStorage,
  formatBytes,
  subscribeStorageChanges,
  totalBytes,
  type StorageCategory,
  type StoredItem,
} from '../storage/registry';
import { defaultStorageCategories } from '../storage/defaultCategories';
import { CHROME_PACKS_PAGE } from '../translation/packStorage';

interface StorageManagerProps {
  isDark: boolean;
  /** Defaults to every registered kind of download */
  categories?: StorageCategory[];
  /** Called after something was deleted, so the page can update its "Saved" marks */
  onChanged?: () => void;
}

type Listing = { items: StoredItem[]; error?: string };

/** What the user is being asked to confirm */
type Pending =
  | { kind: 'all'; category: StorageCategory; bytes: number; approximate: boolean }
  | { kind: 'item'; category: StorageCategory; item: StoredItem };

const sizeText = (bytes: number, approximate = false) => `${approximate ? 'about ' : ''}${formatBytes(bytes)}`;

/** Settings section: how much space downloads take on this device, with buttons to free it. */
export const StorageManager: React.FC<StorageManagerProps> = ({ isDark, categories, onChanged }) => {
  const [list] = useState(() => categories ?? defaultStorageCategories());
  const [listings, setListings] = useState<Record<string, Listing>>({});
  const [loading, setLoading] = useState(true);
  const [site, setSite] = useState<{ usage: number; quota: number } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const generation = useRef(0);

  // Each kind fills in as soon as it's measured, so one slow check doesn't hold up the rest.
  const refresh = useCallback(async () => {
    const gen = ++generation.current;
    const measure = async (category: StorageCategory) => {
      let listing: Listing;
      try {
        listing = { items: await category.list() };
      } catch {
        listing = { items: [], error: 'Couldn’t check this right now.' };
      }
      if (gen === generation.current) setListings((prev) => ({ ...prev, [category.id]: listing }));
    };
    void estimateSiteStorage().then((estimate) => {
      if (gen === generation.current) setSite(estimate);
    });
    await Promise.all(list.map(measure));
    if (gen === generation.current) setLoading(false);
  }, [list]);

  useEffect(() => {
    void refresh();
    return subscribeStorageChanges(() => void refresh());
  }, [refresh]);

  const allItems = Object.values(listings).flatMap((listing) => listing.items);
  const overall = totalBytes(allItems);

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setMessage(null);
    try {
      if (pending.kind === 'all') {
        await pending.category.removeAll?.();
        setMessage({
          tone: 'ok',
          text: `Done. Freed ${sizeText(pending.bytes, pending.approximate)}.`,
        });
      } else {
        await pending.category.removeItem?.(pending.item.id);
        setMessage({
          tone: 'ok',
          text:
            pending.item.bytes !== null
              ? `Deleted ${pending.item.label}. Freed ${sizeText(pending.item.bytes, pending.item.approximate)}.`
              : `Deleted ${pending.item.label}.`,
        });
      }
    } catch {
      setMessage({ tone: 'error', text: 'Couldn’t delete everything. Close other OverHeard tabs and try again.' });
    }
    setPending(null);
    setBusy(false);
    await refresh();
    onChanged?.();
  };

  const copyChromeAddress = async () => {
    try {
      await navigator.clipboard.writeText(CHROME_PACKS_PAGE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const muted = isDark ? 'text-[#94A3B8]' : 'text-slate-600';
  const card = isDark ? 'border-[#243044] bg-[#0D1422]' : 'border-[#CBD5E1] bg-[#F8FAFC]';
  const smallBtn = `oh-btn inline-flex items-center gap-1 px-2 py-1 rounded-[2px] text-[11px] font-semibold border transition-colors disabled:opacity-60 ${
    isDark
      ? 'border-[#2B3952] bg-[#162033] hover:bg-slate-800 text-[#F8FAFC]'
      : 'border-[#CBD5E1] bg-white hover:bg-[#EDF2F7] text-slate-900'
  }`;
  const dangerBtn =
    'inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-bold border border-red-800 bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-60';

  const renderConfirm = () => {
    if (!pending) return null;
    const isAll = pending.kind === 'all';
    const bytes = isAll ? pending.bytes : pending.item.bytes;
    const approximate = isAll ? pending.approximate : pending.item.approximate;
    const what = isAll ? pending.category.title.toLowerCase() : pending.item.label;
    return (
      <div
        role="alertdialog"
        aria-label={isAll ? `Delete all ${what}?` : `Delete ${what}?`}
        className={`p-3 rounded-[3px] border-2 border-red-500/70 space-y-2 text-sm ${
          isDark ? 'bg-red-950/40 text-red-50' : 'bg-red-50 text-red-950'
        }`}
      >
        <p className="flex items-start gap-2 font-bold">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{isAll ? `Delete all ${what}?` : `Delete ${what}?`}</span>
        </p>
        {bytes !== null && bytes > 0 && (
          <p>
            This frees <strong>{sizeText(bytes, approximate)}</strong> on this device.
          </p>
        )}
        <p>
          <strong>{isAll ? 'They will be gone from this device.' : 'It will be gone from this device.'}</strong>{' '}
          {isAll
            ? (pending.category.afterRemoveNote ?? 'You will have to download them again to use them.')
            : (pending.category.afterRemoveItemNote ?? 'You will have to download it again to use it.')}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" className={dangerBtn} disabled={busy} onClick={() => void confirm()}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
            {busy
              ? 'Deleting…'
              : bytes !== null && bytes > 0
                ? `Yes, delete and free ${sizeText(bytes, approximate)}`
                : 'Yes, delete'}
          </button>
          <button type="button" className={smallBtn} disabled={busy} onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  };

  return (
    <section aria-labelledby="storage-title" className="space-y-3">
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-semibold text-sm">
          <HardDrive className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" aria-hidden="true" />
          <h3 id="storage-title">Space used on this device</h3>
        </div>
        <p className={`text-sm ${muted}`} aria-live="polite">
          {loading && allItems.length === 0 ? (
            'Checking…'
          ) : overall.bytes > 0 ? (
            <>
              Downloads from OverHeard take up <strong>{sizeText(overall.bytes, overall.approximate)}</strong>
              {overall.unknown > 0 ? ', plus Chrome language packs (size not reported)' : ''}.
            </>
          ) : overall.unknown > 0 ? (
            'Only Chrome language packs are downloaded (Chrome doesn’t report their size).'
          ) : (
            'Nothing is downloaded yet.'
          )}
          {site && site.usage > 0 && <> Chrome reports {formatBytes(site.usage)} used by this site in total.</>}
        </p>
      </div>

      {message && (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-xs font-medium ${message.tone === 'error' ? 'text-amber-500' : 'text-emerald-500'}`}
        >
          {message.text}
        </p>
      )}

      {list.map((category) => {
        const listing = listings[category.id];
        const items = listing?.items ?? [];
        const sub = totalBytes(items);
        const confirmingAll = pending?.kind === 'all' && pending.category.id === category.id;
        return (
          <div key={category.id} className={`p-4 rounded-[3px] border space-y-2 ${card}`}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h4 className="font-semibold text-sm">{category.title}</h4>
              <span className="text-xs font-mono" data-testid={`storage-total-${category.id}`}>
                {!listing
                  ? '…'
                  : items.length === 0
                    ? 'None'
                    : sub.bytes > 0
                      ? sizeText(sub.bytes, sub.approximate)
                      : `${items.length} installed`}
              </span>
            </div>
            <p className={`text-xs ${muted}`}>{category.description}</p>
            {listing?.error && <p className="text-xs text-amber-500">{listing.error}</p>}

            {items.length > 0 && (
              <ul className="divide-y divide-slate-500/20 text-xs" aria-label={category.title}>
                {items.map((item) => {
                  const confirmingThis =
                    pending?.kind === 'item' && pending.category.id === category.id && pending.item.id === item.id;
                  return (
                    <li key={item.id} className="py-1.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate">{item.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`font-mono ${muted}`}>
                            {item.bytes === null ? 'size not reported' : sizeText(item.bytes, item.approximate)}
                          </span>
                          {item.removable && category.removeItem && (
                            <button
                              type="button"
                              className={smallBtn}
                              aria-label={`Delete ${item.label}`}
                              disabled={busy}
                              onClick={() => {
                                setMessage(null);
                                setPending({ kind: 'item', category, item });
                              }}
                            >
                              <Trash2 className="w-3 h-3" aria-hidden="true" />
                              Delete
                            </button>
                          )}
                        </span>
                      </div>
                      {confirmingThis && renderConfirm()}
                    </li>
                  );
                })}
              </ul>
            )}

            {category.removeAll && items.length > 0 && !confirmingAll && (
              <button
                type="button"
                className={dangerBtn}
                disabled={busy}
                onClick={() => {
                  setMessage(null);
                  setPending({ kind: 'all', category, bytes: sub.bytes, approximate: sub.approximate });
                }}
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Free up space: {category.removeAllLabel ?? `delete all ${category.title.toLowerCase()}`}
                {sub.bytes > 0 ? ` (${sizeText(sub.bytes, sub.approximate)})` : ''}
              </button>
            )}
            {confirmingAll && renderConfirm()}

            {!category.removeAll && category.cannotRemoveNote && items.length > 0 && (
              <div
                className={`p-2.5 rounded-[2px] border text-xs space-y-2 ${
                  isDark
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-100'
                    : 'border-amber-600/40 bg-amber-50 text-amber-950'
                }`}
              >
                <p>{category.cannotRemoveNote}</p>
                {category.cannotRemoveNote.includes(CHROME_PACKS_PAGE) && (
                  <button type="button" className={smallBtn} onClick={() => void copyChromeAddress()}>
                    {copied ? (
                      <Check className="w-3 h-3" aria-hidden="true" />
                    ) : (
                      <Copy className="w-3 h-3" aria-hidden="true" />
                    )}
                    {copied ? 'Copied' : 'Copy Chrome address'}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
};
