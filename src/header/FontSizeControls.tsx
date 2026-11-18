import { FONT_STEP, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../constants';

interface FontSizeControlsProps {
  fontSize: number;
  handleAdjustFont: (delta: number) => void;
}

export function FontSizeControls({
  fontSize, handleAdjustFont,
}: FontSizeControlsProps) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#090D16] p-0.5"
      role="group"
      aria-label="Caption font size"
    >
      <button
        type="button"
        onClick={() => handleAdjustFont(-FONT_STEP)}
        disabled={fontSize <= MIN_FONT_SIZE}
        className="px-2.5 py-1.5 text-xs font-bold rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap"
        title="Decrease font size (A-)"
      >
        A-
      </button>
      <span className="px-2 text-xs font-mono text-[#64748B] dark:text-[#94A3B8] whitespace-nowrap">
        {fontSize}px
      </span>
      <button
        type="button"
        onClick={() => handleAdjustFont(FONT_STEP)}
        disabled={fontSize >= MAX_FONT_SIZE}
        className="px-2.5 py-1.5 text-xs font-bold rounded-md hover:bg-slate-200/70 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors whitespace-nowrap"
        title="Increase font size (A+)"
      >
        A+
      </button>
    </div>
  );
}
