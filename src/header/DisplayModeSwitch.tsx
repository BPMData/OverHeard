import type { DisplayMode } from '../types';
import { Columns3, Subtitles } from 'lucide-react';

interface DisplayModeSwitchProps {
  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;
  enterConversation: () => void;
}

export function DisplayModeSwitch({
  displayMode, setDisplayMode, enterConversation,
}: DisplayModeSwitchProps) {
  return (
    <div className="inline-flex items-stretch rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#EAEFF6] dark:bg-[#090D16] p-0.5">
      <button
        type="button"
        onClick={() => setDisplayMode('columns')}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[2px] text-xs font-semibold transition-colors whitespace-nowrap ${
          displayMode === 'columns'
            ? 'oh-btn-primary border border-[#443180] bg-[#5843A5] dark:bg-[#6D56C6] text-white shadow-2xs'
            : 'text-[#475569] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
        }`}
      >
        <Columns3 className="w-3.5 h-3.5" />
        <span>Columns</span>
      </button>
      <button
        type="button"
        onClick={() => setDisplayMode('subtitle')}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[2px] text-xs font-semibold transition-colors whitespace-nowrap ${
          displayMode === 'subtitle'
            ? 'oh-btn-primary border border-[#443180] bg-[#5843A5] dark:bg-[#6D56C6] text-white shadow-2xs'
            : 'text-[#475569] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
        }`}
      >
        <Subtitles className="w-3.5 h-3.5" />
        <span>Subtitle</span>
      </button>
      <button
        type="button"
        className="flex flex-col items-center justify-center px-2.5 py-0.5 rounded-[2px] text-xs font-semibold leading-[1.1] text-[#475569] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white transition-colors text-center"
        onClick={enterConversation}
      >
        <span>Conversation/</span>
        <span className="text-[11px] font-semibold">Lecture</span>
      </button>
    </div>
  );
}
