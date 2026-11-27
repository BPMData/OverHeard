import { FONT_STEP, MIN_FONT_SIZE, MAX_FONT_SIZE } from '../constants';

interface FontSizeControlsProps {
  fontSize: number;
  handleAdjustFont: (delta: number) => void;
}

export function FontSizeControls({ fontSize, handleAdjustFont }: FontSizeControlsProps) {
  return (
    <div
      className="inline-flex items-center rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#EAEFF6] dark:bg-[#090D16] p-0.5"
      role="group"
      aria-label="Caption font size"
    >
      <button
        type="button"
        onClick={() => handleAdjustFont(-FONT_STEP)}
        disabled={fontSize <= MIN_FONT_SIZE}
        className="px-2.5 py-1.5 text-xs font-bold rounded-[2px] hover:bg-white dark:hover:bg-[#1E293B] disabled:opacity-40 transition-colors whitespace-nowrap"
        title="Decrease font size (A-)"
      >
        A-
      </button>
      <span className="px-2 text-xs font-semibold tabular-nums text-[#475569] dark:text-[#94A3B8] whitespace-nowrap">
        {fontSize}px
      </span>
      <button
        type="button"
        onClick={() => handleAdjustFont(FONT_STEP)}
        disabled={fontSize >= MAX_FONT_SIZE}
        className="px-2.5 py-1.5 text-xs font-bold rounded-[2px] hover:bg-white dark:hover:bg-[#1E293B] disabled:opacity-40 transition-colors whitespace-nowrap"
        title="Increase font size (A+)"
      >
        A+
      </button>
    </div>
  );
}
