import React from 'react';
import { Download } from 'lucide-react';
import { formatElapsed, packLabel } from '../packProgress';

interface Props {
  /** key → 0–1 while downloading, or -1 when Chrome reports no progress (speech packs) */
  progress: Record<string, number>;
  startedAt: number | null;
}

/** Shows on-device language pack downloads. Renders nothing when nothing is downloading. */
export const PackProgressPanel: React.FC<Props> = ({ progress, startedAt }) => {
  const entries = Object.entries(progress);
  if (entries.length === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-col gap-1.5 px-3 py-2 rounded-lg border border-sky-500/30 bg-sky-500/10 text-xs text-slate-700 dark:text-slate-200 min-w-[16rem]"
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <Download className="w-3.5 h-3.5 animate-pulse text-[#0284C7] dark:text-[#38BDF8]" />
        <span>Downloading on-device language packs</span>
        {startedAt !== null && (
          <span className="font-mono text-[#64748B] dark:text-[#94A3B8]">
            {formatElapsed(Date.now() - startedAt)}
          </span>
        )}
      </div>
      <div className="text-[#64748B] dark:text-[#94A3B8]">
        First time only — can take 5–10 minutes. Chrome keeps them for next time.
      </div>
      {entries.map(([key, fraction]) => (
        <div key={key} className="flex items-center gap-2">
          <span className="w-36 truncate">{packLabel(key)}</span>
          <div className="flex-1 h-1.5 rounded-full bg-slate-300/50 dark:bg-slate-700 overflow-hidden">
            <div
              className={`h-full bg-[#0284C7] dark:bg-[#38BDF8] ${
                fraction < 0 ? 'w-1/3 animate-pulse' : ''
              }`}
              style={fraction < 0 ? undefined : { width: `${Math.round(fraction * 100)}%` }}
            />
          </div>
          <span className="w-10 text-right font-mono">
            {fraction < 0 ? '…' : `${Math.round(fraction * 100)}%`}
          </span>
        </div>
      ))}
    </div>
  );
};
