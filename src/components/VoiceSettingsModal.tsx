import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, Settings, ShieldCheck, Square, Volume2, X } from 'lucide-react';
import { piperClient, type PlaybackHandle, type SpeechClient } from '../tts/piperClient';
import { VoiceSelect } from '../tts/VoiceSelect';
import { OFFLINE_TITLE, useOnline } from '../app/useOnline';
import {
  BROWSER_VOICE_ID,
  findPiperVoice,
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
  {
    code: 'ur',
    title: 'Urdu · اردو',
    selectAriaLabel: 'Default Urdu voice',
    previewAriaLabel: 'Preview Urdu voice',
  },
  {
    code: 'id',
    title: 'Indonesian · Bahasa Indonesia',
    selectAriaLabel: 'Default Indonesian voice',
    previewAriaLabel: 'Preview Indonesian voice',
  },
  {
    code: 'sw',
    title: 'Swahili · Kiswahili',
    selectAriaLabel: 'Default Swahili voice',
    previewAriaLabel: 'Preview Swahili voice',
  },
  {
    code: 'tr',
    title: 'Turkish · Türkçe',
    selectAriaLabel: 'Default Turkish voice',
    previewAriaLabel: 'Preview Turkish voice',
  },
  {
    code: 'zh',
    title: 'Chinese · 简体中文',
    selectAriaLabel: 'Default Chinese voice',
    previewAriaLabel: 'Preview Chinese voice',
  },
  {
    code: 'ar',
    title: 'Arabic · العربية',
    selectAriaLabel: 'Default Arabic voice',
    previewAriaLabel: 'Preview Arabic voice',
  },
  {
    code: 'fr',
    title: 'French · Français',
    selectAriaLabel: 'Default French voice',
    previewAriaLabel: 'Preview French voice',
  },
  {
    code: 'uk',
    title: 'Ukrainian · Українська',
    selectAriaLabel: 'Default Ukrainian voice',
    previewAriaLabel: 'Preview Ukrainian voice',
  },
  {
    code: 'ru',
    title: 'Russian · Русский',
    selectAriaLabel: 'Default Russian voice',
    previewAriaLabel: 'Preview Russian voice',
  },
  {
    code: 'prs',
    title: 'Dari · دری',
    selectAriaLabel: 'Default Dari voice',
    previewAriaLabel: 'Preview Dari voice',
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
  const online = useOnline();
  // Piper model ids already saved on this device (null until checked)
  const [savedModels, setSavedModels] = useState<ReadonlySet<string> | null>(null);
  // The voice being saved for offline use right now (one at a time)
  const [savingVoice, setSavingVoice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<{ lang: PiperLanguage; message: string } | null>(null);

  const refreshSaved = useCallback(() => {
    if (!client.listSavedModels) return Promise.resolve();
    return client.listSavedModels().then(
      (ids) => setSavedModels(new Set(ids)),
      () => setSavedModels(new Set()),
    );
  }, [client]);

  useEffect(() => {
    if (isOpen) void refreshSaved();
  }, [isOpen, refreshSaved]);

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

  const isSaved = (voiceId: string) => {
    const voice = findPiperVoice(voiceId);
    return Boolean(voice && savedModels?.has(voice.modelId));
  };

  // Save one language's voice for offline use. Only a click starts this, and only for the voice
  // asked for, so nobody downloads every language's voice (or, on a student page, the ~40 MB
  // voice runtime) without choosing to. The first save also stores that shared runtime.
  const saveForOffline = async (lang: PiperLanguage, voiceId: string) => {
    if (!client.saveForOffline || savingVoice) return;
    setSaveError(null);
    setSavingVoice(voiceId);
    try {
      await client.saveForOffline(voiceId);
    } catch {
      setSaveError({ lang, message: 'Could not save this voice. Check the connection and try again.' });
    }
    setSavingVoice(null);
    await refreshSaved();
  };

  if (!isOpen) return null;

  const darkMode =
    typeof isDark === 'boolean'
      ? isDark
      : typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <div
        className={`w-full max-w-2xl max-h-[90vh] flex flex-col rounded-[3px] border-2 overflow-hidden ${
          darkMode
            ? 'border-[#334155] bg-[#111827] text-[#F8FAFC]'
            : 'border-[#94A3B8] bg-white text-slate-900'
        }`}
      >
        <div
          className={`oh-panel-header flex items-center justify-between px-6 py-3.5 border-b shrink-0 ${
            darkMode ? 'border-[#243044] bg-[#162033]' : 'border-[#CBD5E1] bg-[#F1F5F9]'
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
            className={`oh-btn p-1.5 rounded-[2px] border border-transparent transition-colors ${
              darkMode
                ? 'text-[#94A3B8] hover:text-white hover:border-[#2B3952] hover:bg-slate-800'
                : 'text-slate-500 hover:text-slate-900 hover:border-[#CBD5E1] hover:bg-white'
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
                Choose your default reader voice for each language that has one. Your choices
                save automatically on this device and Piper neural voice models download on demand.
                To use read-aloud offline, click Save offline on a voice while you're online.
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
                  const canSave =
                    Boolean(client.saveForOffline) &&
                    savedModels !== null &&
                    findPiperVoice(selectedVoiceId) !== undefined &&
                    !isSaved(selectedVoiceId);
                  const isSavingThis = savingVoice === selectedVoiceId;
                  const preview = voicePreviewText(code, selectedVoiceId);
                  const isThisLangActive = previewState?.lang === code;

                  return (
                    <div
                      key={code}
                      className={`p-4 rounded-[3px] border space-y-2 ${
                        darkMode
                          ? 'border-[#243044] bg-[#0D1422]'
                          : 'border-[#CBD5E1] bg-[#F8FAFC]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <span className="inline-flex items-center gap-2 font-semibold text-sm">
                          {title}
                          {selectedVoiceId !== BROWSER_VOICE_ID && isSaved(selectedVoiceId) && (
                            <span
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-500"
                              title="This voice is saved on this device and works offline"
                            >
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              Saved
                            </span>
                          )}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <VoiceSelect
                            lang={code}
                            ariaLabel={selectAriaLabel}
                            value={selectedVoiceId}
                            className={`rounded-[2px] border px-2.5 py-1.5 text-xs font-medium outline-none cursor-pointer [&>option]:text-[#0F172A] ${
                              darkMode
                                ? 'border-[#2B3952] bg-[#111827] text-[#F8FAFC]'
                                : 'border-[#CBD5E1] bg-white text-slate-900'
                            }`}
                            onChange={(nextVoice) => {
                              updateVoicePref(code, nextVoice);
                              playPreview(code, nextVoice);
                            }}
                          />
                          {canSave && (
                            <button
                              type="button"
                              aria-label={`Save ${title.split(' · ')[0]} voice for offline`}
                              onClick={() => void saveForOffline(code, selectedVoiceId)}
                              disabled={savingVoice !== null || !online}
                              title={online ? 'Download this voice now so read-aloud works offline' : OFFLINE_TITLE}
                              className={`oh-btn inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] text-xs font-semibold border transition-colors disabled:opacity-60 ${
                                darkMode
                                  ? 'border-[#2B3952] bg-[#162033] hover:bg-slate-800 text-[#F8FAFC]'
                                  : 'border-[#CBD5E1] bg-white hover:bg-[#EDF2F7] text-slate-900'
                              }`}
                            >
                              <CloudDownload className="w-3.5 h-3.5" />
                              <span>{isSavingThis ? 'Saving…' : 'Save offline'}</span>
                            </button>
                          )}
                          {isThisLangActive ? (
                            <button
                              type="button"
                              onClick={stopPreview}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] border border-amber-700 text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors"
                            >
                              <Square className="w-3 h-3" />
                              <span>Stop preview</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              aria-label={previewAriaLabel}
                              onClick={() => playPreview(code, selectedVoiceId)}
                              className="oh-btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[2px] border border-[#443180] text-xs font-semibold bg-[#5843A5] hover:bg-[#4B3891] text-white transition-colors"
                            >
                              <Volume2 className="w-3.5 h-3.5" />
                              <span>Preview</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {saveError?.lang === code && (
                        <p role="alert" className="text-xs font-medium text-amber-500">
                          {saveError.message}
                        </p>
                      )}

                      {isThisLangActive && previewState?.status === 'downloading' && (
                        <p role="status" className="text-xs font-medium text-[#A78BFA]">
                          {typeof previewState.progress === 'number'
                            ? `Downloading voice (${previewState.progress}%)…`
                            : 'Loading voice…'}
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
                  className={`p-3 rounded-[3px] border text-xs leading-relaxed space-y-1 ${
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
            darkMode ? 'border-[#243044] bg-[#0B1120]' : 'border-[#CBD5E1] bg-[#F1F5F9]'
          }`}
        >
          <button
            type="button"
            onClick={() => {
              stopPreview();
              onClose();
            }}
            className="oh-btn-primary px-4 py-2 text-xs font-semibold rounded-[2px] border border-[#443180] bg-[#5843A5] hover:bg-[#4B3891] text-white transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
