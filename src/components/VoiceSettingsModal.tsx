import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Square, Volume2, X } from 'lucide-react';
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
      aria-label="Voice Settings"
    >
      <div
        className={`w-full max-w-2xl rounded-xl border shadow-2xl overflow-hidden ${
          darkMode
            ? 'border-[#1E293B] bg-[#111827] text-[#F8FAFC]'
            : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div
          className={`flex items-center justify-between px-6 py-4 border-b ${
            darkMode ? 'border-[#1E293B]' : 'border-slate-200'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-5 h-5 text-[#5843A5] dark:text-[#A78BFA]" />
            <h2 className="text-lg font-bold tracking-tight">Voice Settings</h2>
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
            aria-label="Close voice settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className={`text-sm ${darkMode ? 'text-[#94A3B8]' : 'text-slate-600'}`}>
            Choose your default reader voice for English, Spanish, and Portuguese. Your choices save
            automatically on this device and voice models download on demand.
          </p>

          {previewError && (
            <p role="alert" className="text-xs font-medium text-amber-500">
              {previewError}
            </p>
          )}

          <div className="space-y-3">
            {VOICE_SETTINGS_LANGUAGES.map(({ code, title, selectAriaLabel, previewAriaLabel }) => {
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

                  <div className={`text-xs space-y-0.5 ${darkMode ? 'text-[#94A3B8]' : 'text-slate-600'}`}>
                    <p className="italic">“{preview.spoken}”</p>
                    {code !== 'en' && <p className="opacity-75">{preview.englishHint}</p>}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className={`pt-3 border-t flex justify-end ${
              darkMode ? 'border-[#1E293B]' : 'border-slate-200'
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
    </div>
  );
};
