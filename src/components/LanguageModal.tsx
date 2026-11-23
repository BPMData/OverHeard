import React, { useState } from 'react';
import { Check, Copy, Globe, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES, MAX_LANGUAGES } from '../constants';
import { LanguageCode } from '../types';
import { CHROME_PACK_SIZE_HINT } from '../translation/packStorage';
import { useModalDismiss } from './useModalDismiss';
import { STUDENTS_STILL_TRANSLATE, fromEnglish, needOnlineText, useLanguagesNeedingOnline } from '../translation/useLanguagesNeedingOnline';

interface LanguageModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLangs: LanguageCode[];
  onToggleLang: (code: LanguageCode) => void;
  /** Choosing a language starts its on-device pack download (Auto / On this device) */
  downloadsPacks?: boolean;
  /** "Only on this device" is chosen: name chosen languages it can't translate */
  onDeviceOnly?: boolean;
}

export const LanguageModal: React.FC<LanguageModalProps> = ({
  isOpen,
  onClose,
  selectedLangs,
  onToggleLang,
  downloadsPacks = false,
  onDeviceOnly = false,
}) => {
  const [copied, setCopied] = useState(false);
  const needOnline = useLanguagesNeedingOnline(fromEnglish(selectedLangs), isOpen && onDeviceOnly);
  const needOnlineNotice = needOnlineText(needOnline);
  const onBackdropClick = useModalDismiss(isOpen, onClose);

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lang-modal-title"
      onClick={onBackdropClick}
    >
      <div className="w-full max-w-2xl max-h-full flex flex-col rounded-[3px] border-2 border-[#94A3B8] dark:border-[#334155] bg-white dark:bg-[#111827] text-slate-900 dark:text-[#F8FAFC] overflow-hidden">
        <div className="oh-panel-header shrink-0 flex items-center justify-between px-6 py-3.5 border-b border-[#CBD5E1] dark:border-[#243044] bg-[#F1F5F9] dark:bg-[#162033]">
          <div className="flex items-center gap-2.5">
            <Globe className="w-5 h-5 text-[#5843A5] dark:text-[#A78BFA]" />
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
              className="oh-btn p-1.5 rounded-[2px] border border-transparent hover:border-[#CBD5E1] dark:hover:border-[#2B3952] text-slate-500 hover:text-slate-900 dark:text-[#94A3B8] dark:hover:text-white hover:bg-white dark:hover:bg-[#1E293B] transition-colors"
              aria-label="Close language settings"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 space-y-5">
          <p className="text-sm text-slate-600 dark:text-[#94A3B8]">
            Select up to {MAX_LANGUAGES} languages to translate simultaneously alongside English. Right-to-left scripts (Arabic, Dari, Pashto, Urdu) render automatically in RTL layout.
          </p>

          {downloadsPacks && (
            <p className="text-sm font-medium px-3 py-2 rounded-[2px] border border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-100">
              Choosing a language starts downloading its on-device translation pack (first time
              only, usually about a minute). Pick your languages before class so captions
              translate on this device, for free, from the first sentence. Each pack takes
              space on this device ({CHROME_PACK_SIZE_HINT}; Chrome doesn't say exactly). Settings
              lists the packs you have.
            </p>
          )}

          {needOnline.length > 0 && (
            <p role="alert" className="text-sm font-semibold px-3 py-2 rounded-[2px] border border-red-600/60 bg-red-600/10 text-red-800 dark:text-red-200">
              ⚠ {needOnlineNotice.names}: “Only on this device” can’t translate{' '}
              {needOnline.length > 1 ? 'these languages' : 'this language'}, so{' '}
              {needOnline.length > 1 ? 'they stay' : 'it stays'} untranslated on this screen. Choose{' '}
              <strong>On-device first</strong> or an online translator in the Translator menu.{' '}
              {STUDENTS_STILL_TRANSLATE}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {SUPPORTED_LANGUAGES.map((lang) => {
              const isChecked = selectedLangs.includes(lang.code);
              const isDisabled =
                (!isChecked && isMaxReached) ||
                (isChecked && selectedLangs.length === 1);

              return (
                <label
                  key={lang.code}
                  className={`flex items-start gap-3 p-3.5 rounded-[3px] border transition-colors select-none ${
                    isChecked
                      ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#EDE9FE]/70 dark:bg-[#2E2356]/55'
                      : isDisabled
                      ? 'border-[#CBD5E1] dark:border-[#243044] opacity-45 cursor-not-allowed'
                      : 'border-[#CBD5E1] dark:border-[#243044] bg-[#F8FAFC] dark:bg-[#0D1422] hover:border-[#94A3B8] dark:hover:border-[#475569] cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={() => onToggleLang(lang.code)}
                    className="mt-1 h-4 w-4 rounded-[2px] border-slate-300 accent-[#5843A5] text-[#5843A5] focus:ring-[#A78BFA]"
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
                      lang={lang.code}
                      className="text-xs text-slate-600 dark:text-[#94A3B8] mt-0.5 truncate"
                    >
                      {lang.nativeName}
                      {lang.dir === 'rtl' ? ' · RTL' : ''}
                    </div>
                    {needOnline.includes(lang.code) && (
                      <div className="text-xs font-semibold text-red-700 dark:text-red-300 mt-0.5">
                        Needs online translation
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Outside the scrolling area so Done stays on screen on short (landscape) screens */}
        <div className="shrink-0 px-6 py-3 border-t border-slate-200 dark:border-[#1E293B] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
              className="oh-btn inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-slate-700 dark:text-slate-200 hover:bg-[#EDF2F7] dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
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
              className="oh-btn-primary px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] dark:bg-[#6D56C6] dark:hover:bg-[#7D66D6] text-white transition-colors whitespace-nowrap"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
