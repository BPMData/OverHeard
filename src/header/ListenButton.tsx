import { Mic, MicOff } from 'lucide-react';

interface ListenButtonProps {
  isListening: boolean;
  toggleListening: () => void;
}

export function ListenButton({
  isListening, toggleListening,
}: ListenButtonProps) {
  return (
    <button
      type="button"
      onClick={toggleListening}
      className={`inline-flex items-center gap-2.5 px-5 py-2.5 rounded-[2px] border font-bold text-sm transition-all cursor-pointer whitespace-nowrap shrink-0 ${
        isListening
          ? 'oh-btn-listening border-[#047857] bg-[#059669] dark:bg-[#10B981] text-white dark:text-slate-950 ring-2 ring-emerald-500/35'
          : 'oh-btn-primary border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white'
      }`}
      title="Toggle microphone (Shortcut: Spacebar)"
    >
      {isListening ? (
        <>
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white dark:bg-slate-950 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-white dark:bg-slate-950" />
          </span>
          <Mic className="w-4 h-4" />
          <span>Stop Listening</span>
        </>
      ) : (
        <>
          <MicOff className="w-4 h-4" />
          <span>Start Listening</span>
        </>
      )}
      <kbd className="hidden sm:inline-block px-1.5 py-px rounded-[2px] border border-white/35 bg-white/10 font-sans text-[10.5px] font-semibold tracking-wide opacity-90">
        Space
      </kbd>
    </button>
  );
}
