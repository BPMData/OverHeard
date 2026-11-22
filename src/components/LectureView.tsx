import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { BookOpen, FolderOpen } from 'lucide-react';
import { LANGUAGE_MAP } from '../constants';
import { DropdownMenu } from './DropdownMenu';
import type { useLectureMode } from '../conversation/useLectureMode';
import { LectureFiles } from '../rooms/LectureFiles';
import { LecturePip } from '../rooms/LecturePip';
import type { LectureState } from '../rooms/protocol';
import { piperClient } from '../tts/piperClient';
import type { useLecturePlayback } from '../tts/useSpeechPlayback';
import { BROWSER_VOICE_ID, resolveVoiceId, type VoicePreferences } from '../tts/voices';
import { VoiceSelect } from '../tts/VoiceSelect';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { ConversationSettings } from './conversationSettings';
import { LectureTranscript } from './LectureTranscript';

type Lecture = ReturnType<typeof useLectureMode>;
type Playback = ReturnType<typeof useLecturePlayback>;

interface DriveStatus {
  message: string;
  link?: string;
}

interface LectureToolsProps {
  active: boolean;
  onSetLanguages?: (languages: LanguageCode[]) => void;
  translatorPicker?: ReactNode;
  lecture: Lecture;
  lectureState: LectureState;
  isDark: boolean;
  fontSize: number;
  onAdjustFont?: (delta: number) => void;
  activeRoomCode: string | null;
  effectiveLectureLang: ConversationLanguage;
  setLecturePlaybackLang: (lang: ConversationLanguage) => void;
  lectureLangs: ConversationLanguage[];
  voicePrefs: VoicePreferences;
  updateVoicePref: (lang: ConversationLanguage, voiceId: string) => void;
  lectureReadAloud: boolean;
  setLectureReadAloud: (checked: boolean) => void;
  settings: ConversationSettings;
  setSettings: Dispatch<SetStateAction<ConversationSettings>>;
  /** Extra File-menu items, e.g. the Google Drive archive buttons */
  fileMenuExtras?: ReactNode;
}

const READ_MODE_LABEL = {
  off: 'Off',
  after: 'After I finish speaking',
  live: 'While I talk (headphones)',
} as const;
const READ_MODE_SHORT = { off: 'Off', after: 'After', live: 'Live' } as const;

export function LectureTools({
  active, onSetLanguages, translatorPicker, lecture, lectureState,
  isDark, fontSize, onAdjustFont, activeRoomCode, effectiveLectureLang,
  setLecturePlaybackLang, lectureLangs, voicePrefs, updateVoicePref, lectureReadAloud,
  setLectureReadAloud, settings, setSettings, fileMenuExtras,
}: LectureToolsProps) {
  const readMode = !lectureReadAloud ? 'off' : settings.lectureLiveReadAloud ? 'live' : 'after';
  return (
    <>
      {translatorPicker && <div className="conversation-lecture-translator">{translatorPicker}</div>}
      <div className="conversation-control-group" role="group" aria-label="Lecture actions">
        <LecturePip state={lectureState} isDark={isDark} fontSize={fontSize}
          onAdjustFont={onAdjustFont ?? (() => {})} active={active} />
        <DropdownMenu
          label="File"
          icon={<FolderOpen className="w-3.5 h-3.5" aria-hidden="true" />}
          title="Clear, export, or import the lecture transcript"
          panelLabel="Transcript files"
        >
          <button
            type="button"
            className="oh-menu-item"
            onClick={lecture.clear}
            disabled={lecture.entries.length === 0 && !lecture.speech.interim}
          >
            Clear lecture
          </button>
          <LectureFiles
            state={lectureState}
            roomCode={activeRoomCode}
            itemClassName="oh-menu-item"
            onImport={value => {
              lecture.replace(value.entries);
              onSetLanguages?.(value.selectedLangs);
            }}
          />
          {fileMenuExtras}
        </DropdownMenu>
      </div>
      <div className="conversation-control-group" role="group" aria-label="Read aloud controls">
        <DropdownMenu
          label={<>Read<span className={`oh-read-chip${readMode === 'off' ? '' : ' is-on'}`}>{READ_MODE_SHORT[readMode]}</span></>}
          ariaLabel={`Read aloud: ${READ_MODE_LABEL[readMode]}`}
          icon={<BookOpen className="w-3.5 h-3.5" aria-hidden="true" />}
          title="Read translations aloud, and choose the reading voice"
          panelLabel="Read aloud"
          align="right"
        >
          {(['off', 'after', 'live'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={readMode === mode}
              className={`oh-menu-item oh-radio-item${readMode === mode ? ' is-checked' : ''}`}
              title={mode === 'live' ? 'Reads along while you talk instead of after each pause. The microphone keeps listening, so use headphones.' : undefined}
              onClick={() => {
                const reading = mode !== 'off';
                setLectureReadAloud(reading);
                setSettings((s) => ({ ...s, lectureLiveReadAloud: mode === 'live' }));
                if (reading && !lectureReadAloud) {
                  piperClient.unlockAudio();
                  const activeVoice = resolveVoiceId(effectiveLectureLang, voicePrefs);
                  if (activeVoice !== BROWSER_VOICE_ID) {
                    piperClient.preloadVoice(activeVoice);
                  }
                }
              }}
            >
              <span className="oh-radio-dot" aria-hidden="true" />
              {READ_MODE_LABEL[mode]}
            </button>
          ))}
          <div className="oh-menu-sep" role="separator" />
          <div className="conversation-voice-controls">
            <label>
              Voice for
              <select
                aria-label="Playback language"
                value={effectiveLectureLang}
                onChange={(e) => setLecturePlaybackLang(e.target.value as ConversationLanguage)}
              >
                {lectureLangs.map((code) => (
                  <option key={code} value={code}>
                    {code === 'en' ? 'English' : LANGUAGE_MAP[code].name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Voice
              <VoiceSelect
                lang={effectiveLectureLang}
                ariaLabel="Voice"
                value={resolveVoiceId(effectiveLectureLang, voicePrefs)}
                onChange={(voiceId) => updateVoicePref(effectiveLectureLang, voiceId)}
              />
            </label>
          </div>
        </DropdownMenu>
      </div>
    </>
  );
}

interface LectureViewProps {
  packPanel?: ReactNode;
  driveStatus: DriveStatus | null;
  setDriveStatus: (status: DriveStatus | null) => void;
  uiError: string;
  lecture: Lecture;
  targetLangs: LanguageCode[];
  fontSize: number;
  isDark: boolean;
  lecturePlayback: Playback;
}

export function LectureView({
  packPanel, driveStatus, setDriveStatus, uiError, lecture, targetLangs, fontSize, isDark,
  lecturePlayback,
}: LectureViewProps) {
  return (
    <>
      {packPanel}
      {driveStatus && (
        <p role="status" className="text-xs flex flex-wrap items-center gap-2">
          <span>{driveStatus.message}</span>
          {driveStatus.link && (
            <a
              href={driveStatus.link}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Open in Drive
            </a>
          )}
          <button
            type="button"
            onClick={() => setDriveStatus(null)}
            className="underline"
          >
            Dismiss
          </button>
        </p>
      )}
      {(uiError || lecture.uiError || lecture.speech.error || !lecture.speech.supported) && (
        <p role="alert">
          {uiError ||
            lecture.uiError ||
            lecture.speech.error ||
            'Speech recognition is unavailable. You can type a line below.'}
        </p>
      )}
      <LectureTranscript
        entries={lecture.entries}
        selectedLangs={targetLangs}
        fontSize={fontSize}
        isDark={isDark}
        isListening={lecture.speech.isListening}
        speechLocal={lecture.speech.speechLocal}
        interim={lecture.speech.interim}
        liveTranslations={lecture.liveTranslations}
        onAddLine={lecture.addLine}
        activePlayback={lecturePlayback.activePlayback}
        onPlayFrom={lecturePlayback.playFrom}
        onTogglePause={lecturePlayback.togglePause}
        onStopPlayback={lecturePlayback.stop}
      />
    </>
  );
}
