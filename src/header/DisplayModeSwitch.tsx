import type { DisplayMode } from '../types';
import { Columns3, MessagesSquare, Subtitles } from 'lucide-react';

interface DisplayModeSwitchProps {
  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;
  enterConversation: () => void;
}

export function DisplayModeSwitch({ displayMode, setDisplayMode, enterConversation }: DisplayModeSwitchProps) {
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
        <Columns3 className="hidden xl:block w-3.5 h-3.5" />
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
        <Subtitles className="hidden xl:block w-3.5 h-3.5" />
        <span>Subtitle</span>
      </button>
      <button
        type="button"
        className="oh-beckon inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-[2px] text-xs font-semibold text-[#A16207] dark:text-[#FACC15] hover:text-[#854D0E] dark:hover:text-[#FDE68A] transition-colors whitespace-nowrap"
        onClick={enterConversation}
      >
        <MessagesSquare className="hidden xl:block w-3.5 h-3.5" aria-hidden="true" />
        <span>Lecture/Conversation</span>
      </button>
    </div>
  );
}
