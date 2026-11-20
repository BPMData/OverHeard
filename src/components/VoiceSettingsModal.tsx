import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Settings, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { piperClient, type PlaybackHandle, type SpeechClient } from '../tts/piperClient';
import { VoiceSelect } from '../tts/VoiceSelect';
import {
  BROWSER_VOICE_ID,
  resolveVoiceId,
  useVoicePreferences,
  voicePreviewText,
  type PiperLanguage,
} from '../tts/voices';

interface VoiceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDark?: boolean;
  client?: SpeechClient;
  /** Show the privacy note about keeping everything on this device */
  showPrivacy?: boolean;
  /** Settings for the page that opened this, shown above the reader voices */
  children?: React.ReactNode;
}

const VOICE_SETTINGS_LANGUAGES: ReadonlyArray<{
  code: PiperLanguage;
  title: string;
  selectAriaLabel: string;
  previewAriaLabel: string;
}> = [
  {
    code: 'en',
    title: 'English',
    selectAriaLabel: 'Default English voice',
    previewAriaLabel: 'Preview English voice',
  },
  {
    code: 'es',
    title: 'Spanish · Español',
    selectAriaLabel: 'Default Spanish voice',
    previewAriaLabel: 'Preview Spanish voice',
  },
  {
    code: 'pt',
    title: 'Portuguese · Português',
    selectAriaLabel: 'Default Portuguese voice',
    previewAriaLabel: 'Preview Portuguese voice',
  },
  {
    code: 'vi',
    title: 'Vietnamese · Tiếng Việt',
    selectAriaLabel: 'Default Vietnamese voice',
    previewAriaLabel: 'Preview Vietnamese voice',
  },
  {
    code: 'hi',
    title: 'Hindi · हिन्दी',
    selectAriaLabel: 'Default Hindi voice',
    previewAriaLabel: 'Preview Hindi voice',
  },
  {
    code: 'bn',
    title: 'Bengali · বাংলা',
    selectAriaLabel: 'Default Bengali voice',
    previewAriaLabel: 'Preview Bengali voice',
  },
];

interface PreviewState {
  lang: PiperLanguage;
  status: 'downloading' | 'playing';
  progress: number | null;
}

export const VoiceSettingsModal: React.FC<VoiceSettingsModalProps> = ({
  isOpen,
  onClose,
  isDark,
  client = piperClient,
  showPrivacy = false,
  children,
}) => {
  const [voicePrefs, updateVoicePref] = useVoicePreferences();
  const [previewState, setPreviewState] = useState<PreviewState | null>(null);
  const [previewError, setPreviewError] = useState('');
  const handleRef = useRef<PlaybackHandle | null>(null);
  const genRef = useRef(0);

  const stopPreview = useCallback(() => {
    genRef.current += 1;
    handleRef.current?.stop();
    handleRef.current = null;
    setPreviewState(null);
  }, []);

  useEffect(() => {
    if (!isOpen) stopPreview();
  }, [isOpen, stopPreview]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        stopPreview();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, stopPreview]);

  const playPreview = useCallback(
    (lang: PiperLanguage, voiceId: string) => {
      stopPreview();
      setPreviewError('');
      client.unlockAudio();
      if (voiceId !== BROWSER_VOICE_ID) {
        client.preloadVoice(voiceId);
      }

      const gen = genRef.current;
      const { spoken } = voicePreviewText(lang, voiceId);
      let settled = false;

      setPreviewState({ lang, status: 'playing', progress: null });

      const handle = client.speak(spoken, {
        lang,
        voiceId,
        onDownloading: (progress) => {
          if (settled || gen !== genRef.current) return;
          setPreviewState({ lang, status: 'downloading', progress });
        },
        onStart: () => {
          if (settled || gen !== genRef.current) return;
          setPreviewState({ lang, status: 'playing', progress: null });
        },
        onEnd: () => {
          if (settled || gen !== genRef.current) return;
          settled = true;
          handleRef.current = null;
          setPreviewState(null);
        },
        onError: (err) => {
          if (settled || gen !== genRef.current) return;
          settled = true;
          handleRef.current = null;
          setPreviewState(null);
          setPreviewError(err.message || 'Unable to preview voice.');
        },
      });

      if (!settled && gen === genRef.current) {
        handleRef.current = handle;
      } else if (gen !== genRef.current) {
        handle.stop();
      }
    },
    [client, stopPreview],
  );

  if (!isOpen) return null;

  const darkMode =
    typeof isDark === 'boolean'
      ? isDark
      : typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden ${
          darkMode
            ? 'border-[#1E293B] bg-[#111827] text-[#F8FAFC]'
            : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
            darkMode ? 'border-[#1E293B]' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Settings className="w-5 h-5 text-[#5843A5] dark:text-[#A78BFA]" aria-hidden="true" />
            <h2 className="text-lg font-bold tracking-tight">Settings</h2>
          </div>
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className={`p-1.5 rounded-lg transition-colors ${
              darkMode
                ? 'text-[#94A3B8] hover:text-white hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
            }`}
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {children && (
            <section
              aria-label="Controls"
              className={`pb-5 border-b ${darkMode ? 'border-[#1E293B]' : 'border-slate-200'}`}
            >
              {children}
            </section>
          )}

          {/* Reader Voices */}
          <section className="space-y-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-semibold text-sm">
                <Volume2 className="w-4 h-4 text-[#5843A5] dark:text-[#A78BFA]" />
                <h3>Reader Voices</h3>
              </div>
              <p className={`text-sm ${darkMode ? 'text-[#94A3B8]' : 'text-slate-600'}`}>
                Choose your default reader voice for English, Spanish, Portuguese, Vietnamese, Hindi, and Bengali. Your choices
                save automatically on this device and Piper neural voice models download on demand.
              </p>
            </div>

            {previewError && (
              <p role="alert" className="text-xs font-medium text-amber-500">
                {previewError}
              </p>
            )}

            <div className="space-y-3">
              {VOICE_SETTINGS_LANGUAGES.map(
                ({ code, title, selectAriaLabel, previewAriaLabel }) => {
                  const selectedVoiceId = resolveVoiceId(code, voicePrefs);
                  const preview = voicePreviewText(code, selectedVoiceId);
                  const isThisLangActive = previewState?.lang === code;

                  return (
                    <div
                      key={code}
                      className={`p-4 rounded-lg border space-y-2 ${
                        darkMode
                          ? 'border-[#1E293B] bg-[#090D16]/60'
                          : 'border-slate-200 bg-slate-50/70'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="font-semibold text-sm">{title}</span>
                        <div className="flex flex-wrap items-center gap-2">
                          <VoiceSelect
                            lang={code}
                            ariaLabel={selectAriaLabel}
                            value={selectedVoiceId}
                            className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium outline-none cursor-pointer [&>option]:text-[#0F172A] ${
                              darkMode
                                ? 'border-[#1E293B] bg-[#111827] text-[#F8FAFC]'
                                : 'border-slate-300 bg-white text-slate-900'
                            }`}
                            onChange={(nextVoice) => {
                              updateVoicePref(code, nextVoice);
                              playPreview(code, nextVoice);
                            }}
                          />
                          {isThisLangActive ? (
                            <button
                              type="button"
                              onClick={stopPreview}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                            >
                              <Square className="w-3 h-3" />
                              <span>Stop preview</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={previewAriaLabel}
                              onClick={() => playPreview(code, selectedVoiceId)}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#5843A5] hover:bg-[#4B3891] text-white transition-colors"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>Preview</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {isThisLangActive && previewState?.status === 'downloading' && (
                        <p role="status" className="text-xs font-medium text-[#A78BFA]">
                          Downloading voice
                          {typeof previewState.progress === 'number'
                            ? ` (${previewState.progress}%)`
                            : ''}
                          …
                        </p>
                      )}

                      <div
                        className={`text-xs space-y-0.5 ${
                          darkMode ? 'text-[#94A3B8]' : 'text-slate-600'
                        }`}
                      >
                        <p className="italic">“{preview.spoken}”</p>
                        {code !== 'en' && <p className="opacity-75">{preview.englishHint}</p>}
                      </div>
                    </div>
                  );
                },
              )}
            </div>
          </section>

          {/* On-device privacy */}
          {showPrivacy && (
            <section
              className={`pt-5 border-t space-y-3 ${
                darkMode ? 'border-[#1E293B]' : 'border-slate-200'
              }`}
            >
                <div
                  className={`p-3 rounded-lg border text-xs leading-relaxed space-y-1 ${
                    darkMode
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                      : 'border-emerald-600/25 bg-emerald-50 text-emerald-950'
                  }`}
                >
                  <div
                    className={`flex items-center gap-1.5 font-semibold ${
                      darkMode ? 'text-emerald-300' : 'text-emerald-800'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>Zero-Cloud / On-Device Guarantee</span>
                  </div>
                  <p>
                    If you select <strong>On this device</strong> in the <strong>Translator</strong>{' '}
                    menu (with
                    supported browser speech and language packs installed, plus local Piper reader
                    voices), speech recognition, translation, and playback all stay inside your
                    browser —{' '}
                    <strong>
                      truly none of your student or classroom data goes online anywhere
                    </strong>{' '}
                    unless you actively host a live <strong>Student Room</strong> (which relays the
                    lecture JSON through server memory to connected students without saving it to
                    disk or a database) or click <strong>Save to Drive</strong>. That mode never uses
                    an online translator: if on-device translation fails, the header says so and the
                    line stays untranslated.
                  </p>
                </div>
            </section>
          )}
        </div>

        <div
          className={`px-6 py-3 border-t flex justify-end shrink-0 ${
            darkMode ? 'border-[#1E293B] bg-[#0B1120]' : 'border-slate-200 bg-slate-50'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#5843A5] hover:bg-[#4B3891] text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
