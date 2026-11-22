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
          className="oh-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#475569] dark:text-[#CBD5E1] hover:text-red-600 dark:hover:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          title="Clear captions and transcript"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      ) : (
        <div className="inline-flex items-center gap-1 rounded-[2px] border border-red-500/50 bg-red-500/10 px-2 py-1">
          <span className="text-xs font-semibold text-red-600 dark:text-red-400">
            Clear all?
          </span>
          <button
            type="button"
            onClick={handleClearConfirm}
            className="px-2 py-0.5 rounded-[2px] bg-red-600 text-white text-xs font-bold hover:bg-red-500"
          >
            Yes
          </button>
          <button
            type="button"
            onClick={() => setConfirmClear(false)}
            className="px-2 py-0.5 rounded-[2px] text-xs text-slate-600 dark:text-slate-300 hover:underline"
          >
            No
          </button>
        </div>
      )}
    </>
  );
}
