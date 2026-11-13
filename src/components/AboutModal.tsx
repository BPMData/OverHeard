import React from 'react';
import { ExternalLink, Info, ShieldAlert, X } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEmbeddedIframe: boolean;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  isEmbeddedIframe,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div className="w-full max-w-xl rounded-xl border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#111827] text-slate-900 dark:text-[#F8FAFC] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-[#1E293B]">
          <div className="flex items-center gap-2.5">
            <Info className="w-5 h-5 text-[#0284C7] dark:text-[#38BDF8]" />
            <div>
              <h2 id="about-modal-title" className="text-lg font-bold tracking-tight">
                About OverHeard & Privacy
              </h2>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8]">
                Part of the family: OverBoard · AllAboard · OverHeard
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close about dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 text-sm leading-relaxed">
          <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-slate-800 dark:text-slate-100 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Privacy Statement</span>
            </div>
            <p className="text-sm text-slate-700 dark:text-slate-200">
              OverHeard has no logins, collects no student data, and stores nothing. Your speech is converted to text by Google&apos;s speech service built into Chrome, and the text is translated by Google Translate and Google Gemini, including partial sentences while you are still speaking. Avoid saying student names or other sensitive information while it is running.
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="font-semibold text-slate-900 dark:text-[#F8FAFC]">
              Classroom Projector & Slides Tips
            </h3>
            <ul className="space-y-2 text-slate-600 dark:text-[#94A3B8] text-xs sm:text-sm">
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Spacebar Shortcut:</strong>{' '}
                Press <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Space</code> anytime (when not typing in a text box) to toggle Start and Stop.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Floating Captions Over Slides:</strong>{' '}
                Click <strong>Pop out captions</strong> to open an always-on-top Picture-in-Picture bar that floats over fullscreen Google Slides or PowerPoint.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Bookmark Your Languages:</strong>{' '}
                Your active languages are saved in the URL (<code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">?langs=es,pt</code>) so you can create separate browser bookmarks for each class period.
              </li>
            </ul>
          </div>

          {isEmbeddedIframe && (
            <div className="p-3.5 rounded-lg border border-sky-500/30 bg-sky-500/10 flex items-center justify-between gap-4">
              <div className="text-xs text-slate-700 dark:text-slate-200">
                Running inside an embedded preview frame? Open OverHeard in a full Chrome tab for unrestricted microphone and floating Picture-in-Picture support.
              </div>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 font-semibold text-xs whitespace-nowrap shrink-0"
              >
                <span>Open Full Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-[#38BDF8] text-white dark:text-slate-950 hover:opacity-90 transition-opacity"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
