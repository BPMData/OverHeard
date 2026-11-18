import type { CaptionSegment } from '../types';
import { Trash2 } from 'lucide-react';

interface ClearTranscriptButtonProps {
  confirmClear: boolean;
  segments: CaptionSegment[];
  interimTranscript: string;
  setConfirmClear: (open: boolean) => void;
  handleClearConfirm: () => void;
}

export function ClearTranscriptButton({
  confirmClear, segments, interimTranscript, setConfirmClear, handleClearConfirm,
}: ClearTranscriptButtonProps) {
  return (
    <>
      {!confirmClear ? (
        <button
          type="button"
          onClick={() => setConfirmClear(true)}
          disabled={segments.length === 0 && !interimTranscript}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          title="Clear captions and transcript"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2 py-1">
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
            Clear all?
          </span>
          <button
            type="button"
            onClick={handleClearConfirm}
            className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-bold hover:bg-red-500"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            className="px-2 py-0.5 rounded text-xs text-slate-600 dark:text-slate-300 hover:underline"
          >
            No
          </button>
        </div>
      )}
    </>
  );
}
