import type { FormEvent } from 'react';
import { SAMPLE_SENTENCES } from '../constants';
import { Send, Zap } from 'lucide-react';

interface TestInputBarProps {
  manualInput: string;
  handleManualSubmit: (event: FormEvent) => void;
  setManualInput: (text: string) => void;
  handleFinalizedPhrase: (text: string) => void;
  handleBurstTest: () => void;
}

export function TestInputBar({
  manualInput,
  handleManualSubmit,
  setManualInput,
  handleFinalizedPhrase,
  handleBurstTest,
}: TestInputBarProps) {
  return (
    <div className="mt-3 pt-3 border-t border-[#E2E8F0] dark:border-[#1E293B] flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
      <form onSubmit={handleManualSubmit} className="flex-1 flex items-center gap-2">
        <input
          type="text"
          value={manualInput}
          onChange={(e) => setManualInput(e.target.value)}
          maxLength={500}
          placeholder="Type an English classroom sentence to test translation silently…"
          className="flex-1 rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#090D16] px-3.5 py-2 text-sm text-[#0F172A] dark:text-[#F8FAFC] placeholder:text-[#64748B] dark:placeholder:text-[#94A3B8] focus:outline-none focus:border-[#5843A5] dark:focus:border-[#A78BFA]"
        />
        <button
          type="submit"
          disabled={!manualInput.trim()}
          className="oh-btn-primary inline-flex items-center gap-1.5 px-4 py-2 rounded-[2px] border border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white text-xs font-bold disabled:opacity-40 transition-all whitespace-nowrap"
        >
          <Send className="w-3.5 h-3.5" />
          <span>Translate</span>
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-[#64748B] dark:text-[#94A3B8] mr-1">Samples:</span>
        {SAMPLE_SENTENCES.map((sample) => (
          <button
            key={sample.subject}
            type="button"
            onClick={() => handleFinalizedPhrase(sample.text)}
            className="oh-btn px-2.5 py-1.5 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#090D16] hover:border-[#5843A5] dark:hover:border-[#A78BFA] transition-colors whitespace-nowrap"
          >
            {sample.subject}
          </button>
        ))}
        <button
          type="button"
          onClick={handleBurstTest}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-[2px] text-xs font-semibold border border-amber-500/50 bg-amber-500/10 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20 transition-colors whitespace-nowrap"
          title="Send 5 rapid sentences to test concurrent in-order rendering and the >4 in-flight backlog guard"
        >
          <Zap className="w-3 h-3" />
          <span>Fast Burst (5x)</span>
        </button>
      </div>
    </div>
  );
}
