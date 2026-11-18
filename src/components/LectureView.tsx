import type { Dispatch, ReactNode, SetStateAction } from 'react';
import { LANGUAGE_MAP } from '../constants';
import type { useLectureMode } from '../conversation/useLectureMode';
import type { SaveLectureToDriveResult } from '../lib/googleDrive';
import { LectureFiles } from '../rooms/LectureFiles';
import { LecturePip } from '../rooms/LecturePip';
import type { LectureState } from '../rooms/protocol';
import { piperClient } from '../tts/piperClient';
import type { useLecturePlayback } from '../tts/useSpeechPlayback';
import { BROWSER_VOICE_ID, resolveVoiceId, type VoicePreferences } from '../tts/voices';
import { PlaybackToolbar, VoiceSelect } from '../tts/VoiceSelect';
import type { ConversationLanguage, LanguageCode } from '../types';
import type { ConversationSettings } from './conversationSettings';
import { OpenFromDriveButton, SaveLectureToDriveControl } from './DriveLectureActions';
import { LectureTranscript } from './LectureTranscript';

type Lecture = ReturnType<typeof useLectureMode>;
type Playback = ReturnType<typeof useLecturePlayback>;

interface DriveStatus {
  message: string;
  link?: string;
}

interface LectureSettingsProps {
  active: boolean;
  targetLangs: LanguageCode[];
  onOpenLanguages?: () => void;
  onSetLanguages?: (languages: LanguageCode[]) => void;
  translatorPicker?: ReactNode;
  lecture: Lecture;
  lectureState: LectureState;
  isDark: boolean;
  fontSize: number;
  onAdjustFont?: (delta: number) => void;
  activeRoomCode: string | null;
  setUiError: (message: string) => void;
  setDriveStatus: (status: DriveStatus | null) => void;
  effectiveLectureLang: ConversationLanguage;
  setLecturePlaybackLang: (lang: ConversationLanguage) => void;
  lectureLangs: ConversationLanguage[];
  voicePrefs: VoicePreferences;
  updateVoicePref: (lang: ConversationLanguage, voiceId: string) => void;
  lectureReadAloud: boolean;
  setLectureReadAloud: (checked: boolean) => void;
  settings: ConversationSettings;
  setSettings: Dispatch<SetStateAction<ConversationSettings>>;
  lecturePlayback: Playback;
}

export function LectureSettings({
  active, targetLangs, onOpenLanguages, onSetLanguages, translatorPicker, lecture, lectureState,
  isDark, fontSize, onAdjustFont, activeRoomCode, setUiError, setDriveStatus, effectiveLectureLang,
  setLecturePlaybackLang, lectureLangs, voicePrefs, updateVoicePref, lectureReadAloud,
  setLectureReadAloud, settings, setSettings, lecturePlayback,
}: LectureSettingsProps) {
  return (
    <>
      {onOpenLanguages && (
        <button type="button" className="conversation-langs-btn" onClick={onOpenLanguages}>
          Languages ({targetLangs.join(', ')})
        </button>
      )}
      {translatorPicker}
      <button
        type="button"
        className={`conversation-start ${lecture.speech.isListening ? 'is-listening' : ''}`}
        onClick={lecture.speech.isListening ? lecture.stop : lecture.start}
        disabled={!lecture.speech.supported}
      >
        {lecture.speech.isListening ? 'Pause lecture' : 'Start lecture'}
      </button>
      <LecturePip state={lectureState} isDark={isDark} fontSize={fontSize}
        onAdjustFont={onAdjustFont ?? (() => {})} active={active} />
      <button
        type="button"
        onClick={lecture.clear}
        disabled={lecture.entries.length === 0 && !lecture.speech.interim}
      >
        Clear lecture
      </button>
      <LectureFiles
        state={lectureState}
        roomCode={activeRoomCode}
        onImport={value => {
          lecture.replace(value.entries);
          onSetLanguages?.(value.selectedLangs);
        }}
      />
      <SaveLectureToDriveControl
        state={lectureState}
        roomCode={activeRoomCode}
        className="inline-flex items-center gap-1.5"
        onSaved={(result: SaveLectureToDriveResult) => {
          setUiError('');
          setDriveStatus({
            message: `${result.updatedExisting ? 'Updated' : 'Saved'} "${result.file.name}" in Google Drive (${result.folder.name}).`,
            link: result.file.webViewLink,
          });
        }}
        onError={(msg) => {
          if (msg) setDriveStatus(null);
          setUiError(msg);
        }}
      />
      <OpenFromDriveButton
        className="inline-flex items-center gap-1.5"
        hasExistingEntries={() => lecture.entries.length > 0}
        onImport={(imported, file) => {
          setUiError('');
          lecture.replace(imported.entries);
          onSetLanguages?.(imported.selectedLangs);
          setDriveStatus({
            message: `Opened "${file.name}" from Google Drive.`,
          });
        }}
        onError={(msg) => {
          if (msg) setDriveStatus(null);
          setUiError(msg);
        }}
      />
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
      <label>
        <input
          type="checkbox"
          checked={lectureReadAloud}
          onChange={(e) => {
            const checked = e.target.checked;
            setLectureReadAloud(checked);
            if (checked) {
              piperClient.unlockAudio();
              const activeVoice = resolveVoiceId(effectiveLectureLang, voicePrefs);
              if (activeVoice !== BROWSER_VOICE_ID) {
                piperClient.preloadVoice(activeVoice);
              }
            }
          }}
        />
        Read aloud
      </label>
      <label title="Reads along while you talk instead of after each pause. The microphone keeps listening, so use headphones.">
        <input
          type="checkbox"
          checked={settings.lectureLiveReadAloud}
          disabled={!lectureReadAloud}
          onChange={(e) => {
            const checked = e.target.checked;
            setSettings((s) => ({ ...s, lectureLiveReadAloud: checked }));
          }}
        />
        While I talk (headphones)
      </label>
      <PlaybackToolbar
        status={lecturePlayback.status}
        downloadProgress={lecturePlayback.downloadProgress}
        onTogglePause={lecturePlayback.togglePause}
        onStop={lecturePlayback.stop}
      />
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
      <p className="conversation-help">
        Continuous single-speaker English lecture mode. Live translations stream across columns
        as you speak and stay saved locally until cleared.
      </p>
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
