interface ClearTranscriptButtonProps {
  confirmClear: boolean;
  setConfirmClear: (open: boolean) => void;
  handleClearConfirm: () => void;
}

/** Inline "Clear all?" confirmation shown in the toolbar after File → Clear. */
export function ClearTranscriptButton({
  confirmClear, setConfirmClear, handleClearConfirm,
}: ClearTranscriptButtonProps) {
  if (!confirmClear) return null;
  return (
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
  );
}
