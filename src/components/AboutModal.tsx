import React from 'react';
import { createPortal } from 'react-dom';
import {
  BookOpen,
  Cloud,
  ExternalLink,
  HelpCircle,
  Keyboard,
  ShieldAlert,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { WhiteboatIcon } from './WhiteboatIcon';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  isEmbeddedIframe?: boolean;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  isOpen,
  onClose,
  isEmbeddedIframe,
}) => {
  if (!isOpen) return null;

  const embedded =
    isEmbeddedIframe ??
    (() => {
      try {
        return typeof window !== 'undefined' && window.self !== window.top;
      } catch {
        return true;
      }
    })();

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="about-modal-title"
    >
      <div className="w-full max-w-3xl max-h-[88vh] flex flex-col rounded-2xl border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#111827] text-slate-900 dark:text-[#F8FAFC] shadow-2xl overflow-hidden">
        {/* Sticky Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-[#1E293B] shrink-0">
          <div className="flex items-center gap-3">
            <WhiteboatIcon app="overheard" size={32} className="shadow-xs" />
            <div>
              <h2 id="about-modal-title" className="text-base sm:text-lg font-bold tracking-tight">
                How to Use OverHeard — Guide &amp; FAQ
              </h2>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500 dark:text-[#94A3B8]">
                <span>Part of the family:</span>
                <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                  <WhiteboatIcon app="overboard" size={15} />
                  <span>OverBoard</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-medium text-slate-700 dark:text-slate-200">
                  <WhiteboatIcon app="allaboard" size={15} />
                  <span>AllAboard</span>
                </span>
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1 font-semibold text-[#5843A5] dark:text-[#C4B5FD]">
                  <WhiteboatIcon app="overheard" size={15} />
                  <span>OverHeard</span>
                </span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close guide dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Quick Jump Pills */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 sm:px-6 py-2.5 border-b border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0B1120] text-xs shrink-0">
          {[
            ['guide-start', 'Quick Start'],
            ['guide-shortcuts', 'Shortcuts & Floating Window'],
            ['guide-modes', 'Modes & Student Rooms'],
            ['guide-voices', 'Voices & Saves'],
            ['guide-faq', 'FAQ & Privacy'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => scrollToSection(id)}
              className="px-2.5 py-1 rounded-md font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#111827] text-slate-700 dark:text-slate-200 hover:border-[#5843A5] dark:hover:border-[#A78BFA] transition-colors"
            >
              {label}
            </button>
          ))}
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 space-y-6 text-xs sm:text-sm leading-relaxed overflow-y-auto">
          {embedded && (
            <div className="p-3.5 rounded-lg border border-[#5843A5]/30 dark:border-[#A78BFA]/30 bg-[#5843A5]/10 dark:bg-[#5843A5]/20 flex items-center justify-between gap-4">
              <div className="text-xs text-slate-700 dark:text-slate-200">
                Running inside an embedded frame? Open OverHeard in a full Chrome tab for the smoothest microphone and Picture-in-Picture experience.
              </div>
              <a
                href={window.location.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white font-semibold text-xs whitespace-nowrap shrink-0 transition-colors"
              >
                <span>Open Full Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          )}

          {/* Section 1: Quick Start */}
          <section id="guide-start" className="space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-[#F8FAFC]">
              <BookOpen className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
              <h3>Quick Start (30 Seconds)</h3>
            </div>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-600 dark:text-[#94A3B8]">
              <li>
                Open OverHeard in <strong className="text-slate-800 dark:text-slate-200">Google Chrome</strong> or <strong className="text-slate-800 dark:text-slate-200">Microsoft Edge</strong> and click <strong className="text-slate-800 dark:text-slate-200">Languages</strong> to pick 1–3 target languages.
              </li>
              <li>
                Click <strong className="text-slate-800 dark:text-slate-200">Start Listening</strong> (or press <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Space</code>) and allow microphone access if prompted.
              </li>
              <li>
                Need quiet testing? Click <strong className="text-slate-800 dark:text-slate-200">Test Input</strong> to type or fire sample classroom sentences without speaking out loud.
              </li>
              <li>
                Bookmark the page URL (like <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">?langs=es,pt</code>) to save language setups for different class periods.
              </li>
            </ol>
          </section>

          {/* Section 2: Shortcuts & Floating Captions */}
          <section id="guide-shortcuts" className="space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-[#F8FAFC]">
              <Keyboard className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
              <h3>Shortcuts &amp; Always-On-Top Floating Captions</h3>
            </div>
            <ul className="space-y-2 text-slate-600 dark:text-[#94A3B8]">
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Spacebar Shortcut (Listening Mode):</strong>{' '}
                In the default <strong className="text-slate-800 dark:text-slate-200">Columns</strong> or <strong className="text-slate-800 dark:text-slate-200">Subtitle</strong> projector view, press <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Space</code> anytime (when not typing in a text box or menu) to toggle Start and Pause.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Spacebar in Conversation / Lecture Mode:</strong>{' '}
                In <strong className="text-slate-800 dark:text-slate-200">Two-Way Conversation</strong> with <strong className="text-slate-800 dark:text-slate-200">Manual (Press Space)</strong> turn-taking enabled, <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Space</code> switches to the next speaker instead of toggling Start/Pause (and <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Left Shift</code> / <code className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Right Shift</code> jumps to Speaker A or B). In <strong className="text-slate-800 dark:text-slate-200">Lecture</strong> mode, use the Start/Pause button.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Floating Captions Everywhere (<code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">Pop out captions</code>):</strong>{' '}
                Click <strong className="text-slate-800 dark:text-slate-200">Pop out captions</strong> to open an always-on-top Picture-in-Picture caption bar that floats above everything on your screen — fullscreen Google Slides, PowerPoint, PDFs, browser tabs, and other desktop windows (exclusive fullscreen apps like some PC games may still stay on top).
              </li>
            </ul>
          </section>

          {/* Section 3: Modes & Student Rooms */}
          <section id="guide-modes" className="space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-[#F8FAFC]">
              <Users className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
              <h3>Which Mode Should I Use?</h3>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
                <div className="font-bold text-slate-900 dark:text-[#F8FAFC]">Columns / Subtitle</div>
                <p className="text-slate-600 dark:text-[#94A3B8]">
                  Best for whole-class projection. Switch between multi-language <strong className="text-slate-800 dark:text-slate-200">Columns</strong>, a single-line <strong className="text-slate-800 dark:text-slate-200">Subtitle</strong> strip, or <strong className="text-slate-800 dark:text-slate-200">Pop out captions</strong> over slides.
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
                <div className="font-bold text-slate-900 dark:text-[#F8FAFC]">Lecture + Student Rooms</div>
                <p className="text-slate-600 dark:text-[#94A3B8]">
                  Keeps a running lesson transcript. Enter a 4+ character PIN and click <strong className="text-slate-800 dark:text-slate-200">Create room</strong> to give students a live <code className="font-mono">?room=...</code> link on their own devices (or use <strong className="text-slate-800 dark:text-slate-200">Rejoin room</strong> later with the same code + PIN).
                </p>
              </div>
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
                <div className="font-bold text-slate-900 dark:text-[#F8FAFC]">Two-Way Conversation</div>
                <p className="text-slate-600 dark:text-[#94A3B8]">
                  Built for 1-on-1 conferences across two languages. Choose auto speaker switching or <strong className="text-slate-800 dark:text-slate-200">Manual (Press Space)</strong>, or type messages directly below the thread.
                </p>
              </div>
            </div>
          </section>

          {/* Section 4: Voices, Saving & Google Drive */}
          <section id="guide-voices" className="space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-[#F8FAFC]">
              <Volume2 className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
              <h3>Voices, JSON Files &amp; Google Drive Saves</h3>
            </div>
            <ul className="space-y-2 text-slate-600 dark:text-[#94A3B8]">
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Settings (Voices &amp; Privacy) &amp; Click-to-Read:</strong>{' '}
                Open <strong className="text-slate-800 dark:text-slate-200">Settings</strong> (speaker icon on the main bar, Conversation/Lecture mode, and Student room pages) to pick default Piper neural voices for <strong className="text-slate-800 dark:text-slate-200">English</strong>, <strong className="text-slate-800 dark:text-slate-200">Spanish</strong>, and <strong className="text-slate-800 dark:text-slate-200">Portuguese</strong> with instant audio previews. Click any line&apos;s play button to read aloud from there, or toggle <strong className="text-slate-800 dark:text-slate-200">Read aloud</strong>.
              </li>
              <li>
                <strong className="text-slate-800 dark:text-slate-200">Local JSON Export &amp; Import:</strong>{' '}
                Both teachers and students can export portable <code className="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-xs">.json</code> transcripts (named cleanly by room and date). Re-open them anytime via <strong className="text-slate-800 dark:text-slate-200">Import JSON</strong> on the main screen or in Lecture mode — no Google account required.
              </li>
              <li className="flex items-start gap-2">
                <Cloud className="w-4 h-4 shrink-0 text-[#5843A5] dark:text-[#A78BFA] mt-0.5" />
                <span>
                  <strong className="text-slate-800 dark:text-slate-200">Google Drive Saves:</strong>{' '}
                  In Lecture mode, <strong className="text-slate-800 dark:text-slate-200">Save to Drive</strong> automatically creates or reuses an <strong className="text-slate-800 dark:text-slate-200">OverHeard Saves</strong> folder in your Drive (or lets you pick/create another folder, update an existing file in place, or save a new copy). <strong className="text-slate-800 dark:text-slate-200">Open from Drive</strong> works from both the main bar and Lecture mode. Saved files never contain teacher room PINs or credentials.
                </span>
              </li>
            </ul>
          </section>

          {/* Section 5: FAQ & Privacy */}
          <section id="guide-faq" className="space-y-3">
            <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-[#F8FAFC]">
              <HelpCircle className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
              <h3>Frequently Asked Questions</h3>
            </div>
            <div className="space-y-2.5 text-slate-600 dark:text-[#94A3B8]">
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Why isn&apos;t Start Listening working or why do I see a browser warning?
                </div>
                <p>
                  Live microphone speech recognition relies on the browser&apos;s Web Speech API, which is supported in <strong className="text-slate-800 dark:text-slate-200">Chrome</strong> and <strong className="text-slate-800 dark:text-slate-200">Edge</strong> over <code className="font-mono text-xs">https://</code> (or <code className="font-mono text-xs">localhost</code>). If Chrome blocks the mic, click the site settings icon in the address bar and allow Microphone.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  What if my school Google account says Google Drive access is blocked by an administrator?
                </div>
                <p>
                  Some school Google Workspace domains block third-party OAuth apps until IT marks the app trusted. You can still use a personal Google account for Drive saves, or use local <strong className="text-slate-800 dark:text-slate-200">Export JSON</strong> / <strong className="text-slate-800 dark:text-slate-200">Import JSON</strong> anytime.
                </p>
              </div>
              <div>
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Why did a voice pause for a few seconds the first time I played it?
                </div>
                <p>
                  Piper neural voices download their voice model once on first playback and cache it in your browser&apos;s local storage so subsequent sentences play fast and work offline.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-lg border border-amber-500/30 bg-amber-500/10 text-slate-800 dark:text-slate-100 space-y-1.5">
              <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>Privacy Statement</span>
              </div>
              <p className="text-xs sm:text-sm text-slate-700 dark:text-slate-200">
                OverHeard requires no login to caption or translate. Spoken audio is transcribed by your browser&apos;s speech service, and text is translated locally when <strong className="text-slate-900 dark:text-white">Auto</strong> can use Chrome&apos;s on-device translator; otherwise text (including live interim phrases) is sent to Google Translate (the free endpoint first, then Google Cloud Translation). Choose <strong className="text-slate-900 dark:text-white">On this device</strong> in the Translator menu so speech, translation, and playback stay completely offline; that mode never falls back to an online translator — unless you actively start a live <strong className="text-slate-900 dark:text-white">Student Room</strong> (held only in temporary server memory to stream JSON updates, never saved to disk or a database) or use <strong className="text-slate-900 dark:text-white">Google Drive</strong> saves (which use Google&apos;s narrow <code className="font-mono text-xs">drive.file</code> scope).
              </p>
            </div>
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="px-5 sm:px-6 py-3 border-t border-slate-200 dark:border-[#1E293B] bg-slate-50 dark:bg-[#0B1120] flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modal, document.body)
    : modal;
};
