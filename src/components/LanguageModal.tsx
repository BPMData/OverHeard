import React, { useState } from 'react';
import { Check, Copy, Globe, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES, MAX_LANGUAGES } from '../constants';
import { LanguageCode } from '../types';

interface LanguageModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLangs: LanguageCode[];
  onToggleLang: (code: LanguageCode) => void;
}

export const LanguageModal: React.FC<LanguageModalProps> = ({
  isOpen,
  onClose,
  selectedLangs,
  onToggleLang,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const isMaxReached = selectedLangs.length >= MAX_LANGUAGES;
  const bookmarkUrl = `${window.location.origin}${window.location.pathname}?langs=${selectedLangs.join(',')}`;

  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(bookmarkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard is restricted in iframe
      setCopied(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lang-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl border border-slate-200 dark:border-[#1E293B] bg-white dark:bg-[#111827] text-slate-900 dark:text-[#F8FAFC] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-[#1E293B]">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-[#0284C7] dark:text-[#38BDF8]" />
            <h2 id="lang-modal-title" className="text-lg font-bold tracking-tight">
              Target Classroom Languages
            </h2>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono text-slate-600 dark:text-[#94A3B8]">
              {selectedLangs.length} / {MAX_LANGUAGES} selected
              {isMaxReached ? ' · Max 3 languages' : ''}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close language settings"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <p className="text-sm text-slate-600 dark:text-[#94A3B8]">
            Select up to {MAX_LANGUAGES} languages to translate simultaneously alongside English. Right-to-left scripts (Arabic, Dari, Pashto) render automatically in RTL layout.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isChecked = selectedLangs.includes(lang.code);
              const isDisabled =
                (!isChecked && isMaxReached) ||
                (isChecked && selectedLangs.length === 1);

              return (
                <label
                  key={lang.code}
                  className={`flex items-start gap-3 p-3.5 rounded-lg border transition-colors select-none ${
                    isChecked
                      ? 'border-[#0284C7] dark:border-[#38BDF8] bg-sky-50/70 dark:bg-sky-950/30'
                      : isDisabled
                      ? 'border-slate-200 dark:border-[#1E293B] opacity-45 cursor-not-allowed'
                      : 'border-slate-200 dark:border-[#1E293B] hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => onToggleLang(lang.code)}
                    className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0284C7] focus:ring-[#38BDF8]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="font-semibold text-sm text-slate-900 dark:text-[#F8FAFC] truncate">
                        {lang.name}
                      </span>
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500">
                        {lang.code}
                      </span>
                    </div>
                    <div
                      dir={lang.dir}
                      className="text-xs text-slate-600 dark:text-[#94A3B8] mt-0.5 truncate"
                    >
                      {lang.nativeName}
                      {lang.dir === 'rtl' ? ' · RTL' : ''}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="pt-3 border-t border-slate-200 dark:border-[#1E293B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-slate-500 dark:text-[#94A3B8]">
                Bookmarkable Classroom Setup URL
              </div>
              <div className="text-xs font-mono text-slate-700 dark:text-slate-300 truncate mt-0.5">
                {bookmarkUrl}
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg border border-slate-200 dark:border-[#1E293B] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                    Copied URL
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    Copy Bookmark Link
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#0284C7] dark:bg-[#38BDF8] text-white dark:text-slate-950 hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
