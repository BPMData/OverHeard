import React from 'react';
import { Download, MousePointerClick } from 'lucide-react';
import { formatElapsed, packLabel } from '../packProgress';
import { PACK_NEEDS_CLICK, startWaitingPack, waitingPackSize } from '../onDevice';

interface Props {
  /**
   * key → 0–1 while downloading, -1 when Chrome reports no progress (speech packs), or
   * PACK_NEEDS_CLICK while the pack waits for a click to start (see PACK_NEEDS_CLICK)
   */
  progress: Record<string, number>;
  startedAt: number | null;
}

/** Shows on-device language pack downloads. Renders nothing when nothing is downloading. */
export const PackProgressPanel: React.FC<Props> = ({ progress, startedAt }) => {
  const entries = Object.entries(progress);
  if (entries.length === 0) return null;
  const waiting = entries.filter(([, fraction]) => fraction === PACK_NEEDS_CLICK);
  const downloading = entries.filter(([, fraction]) => fraction !== PACK_NEEDS_CLICK);
  // Bergamot models (Safari, Firefox, or a language Chrome lacks) show their size before downloading
  const allSized = waiting.every(([key]) => waitingPackSize(key) !== null);
  return (
    <div
      role="status"
      className="flex flex-col gap-1.5 px-3 py-2 rounded-[3px] border border-[#5843A5]/40 dark:border-[#A78BFA]/40 bg-[#EDE9FE] dark:bg-[#1E1838] text-xs text-slate-700 dark:text-slate-200 min-w-[16rem]"
    >
      {waiting.length > 0 && (
        <div className="flex flex-col gap-1.5 p-2 -mx-1 rounded-[2px] border border-amber-500/60 bg-amber-500/15 text-amber-900 dark:text-amber-100">
          <div className="flex items-center gap-1.5 font-semibold">
            <MousePointerClick className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>
              {waiting.length === 1
                ? '1 language pack is waiting for you'
                : `${waiting.length} language packs are waiting for you`}
            </span>
          </div>
          <div>
            {allSized
              ? 'These languages can translate on this device after a one-time download. Click each one to download it; until then its captions stay untranslated or use online translation.'
              : 'Chrome starts only one download per click. Click each language to start it; until then its captions stay untranslated or use online translation.'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {waiting.map(([key]) => {
              const sized = waitingPackSize(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => startWaitingPack(key)}
                  title={sized?.note ? `This uses a related language’s model (${sized.note}).` : undefined}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[2px] font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 animate-pulse"
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                  Download {packLabel(key)}
                  {sized && ` (${sized.note ? `${sized.note}, ` : ''}${sized.size})`}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {downloading.length > 0 && (
        <>
          <div className="flex items-center gap-1.5 font-semibold">
            <Download className="w-3.5 h-3.5 animate-pulse text-[#5843A5] dark:text-[#A78BFA]" />
            <span>Downloading on-device language packs</span>
            {startedAt !== null && (
              <span className="font-mono text-[#64748B] dark:text-[#94A3B8]">
                {formatElapsed(Date.now() - startedAt)}
              </span>
            )}
          </div>
          <div className="text-[#64748B] dark:text-[#94A3B8]">
            First time only — usually about a minute. They’re kept on this device for next time. Tip: pick languages
            before class; choosing one starts its download.
          </div>
          {downloading.map(([key, fraction]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-36 truncate">{packLabel(key)}</span>
              <div className="flex-1 h-1.5 rounded-full bg-slate-300/50 dark:bg-slate-700 overflow-hidden">
                <div
                  className={`h-full bg-[#5843A5] dark:bg-[#A78BFA] ${fraction < 0 ? 'w-1/3 animate-pulse' : ''}`}
                  style={fraction < 0 ? undefined : { width: `${Math.round(fraction * 100)}%` }}
                />
              </div>
              <span className="w-10 text-right font-mono">{fraction < 0 ? '…' : `${Math.round(fraction * 100)}%`}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
};
