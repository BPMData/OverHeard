import { PlaybackToolbar } from '../tts/VoiceSelect';
import { TeacherRoomControls } from '../rooms/TeacherRoomControls';
import { LectureTools } from './LectureView';
import { OpenFromDriveButton, SaveLectureToDriveControl } from './DriveLectureActions';
import type { Dispatch, SetStateAction } from 'react';
import type { ConversationModeProps } from './ConversationMode';
import type { ConversationSettings } from './conversationSettings';
import type { useLectureWorkspace } from '../conversation/useLectureWorkspace';
import type { VoicePreferences } from '../tts/voices';
import type { ConversationLanguage } from '../types';

type Common = { settings: ConversationSettings; setSettings: Dispatch<SetStateAction<ConversationSettings>>;
  voicePrefs: VoicePreferences; updateVoicePref: (lang: ConversationLanguage, voiceId: string) => void;
  showAllControls: boolean; isLecture: boolean };
type Props = Common & ReturnType<typeof useLectureWorkspace> &
  Pick<ConversationModeProps, 'active' | 'onSetLanguages' | 'translatorPicker' | 'isDark' | 'fontSize' | 'onAdjustFont'> & {
  setUiError: (message: string) => void;
};
export function LectureToolbar({ settings, setSettings, voicePrefs, updateVoicePref, showAllControls,
  isLecture, active, onSetLanguages, translatorPicker, isDark, fontSize, onAdjustFont, setUiError,
  lecture, lectureState, lecturePlayback, activeRoomCode, setDriveStatus, roomControlsId, roomCodeRef,
  shareSetupOpen, handleRoomCodeChange, lectureToolsId, effectiveLectureLang, setLecturePlaybackLang,
  lectureLangs, lectureReadAloud, setLectureReadAloud }: Props) {
  const driveArchive = (className: string) => (
    <>
      <SaveLectureToDriveControl
        label="Save room archive to Drive"
        state={lectureState}
        roomCode={activeRoomCode}
        className={className}
        onSaved={(result) => {
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
        label="Open room archive from Drive"
        className={className}
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
    </>
  );
  return (
    <>
      {/* Room setup and lecture tools share one row when they fit */}
      <div className="lecture-bar">
        <TeacherRoomControls
          id={roomControlsId}
          roomCodeRef={roomCodeRef}
          guideSetup={!showAllControls}
          showSetup={showAllControls || shareSetupOpen}
          archiveControls={isLecture && !showAllControls && driveArchive('inline-flex items-center gap-1.5')}
          state={lectureState}
          visible={isLecture}
          onRoomCodeChange={handleRoomCodeChange}
          onRestore={restored => {
            lecture.replace(restored.entries, { preserveIds: true });
            if (restored.selectedLangs.length > 0) onSetLanguages?.(restored.selectedLangs);
          }}
        />
        {isLecture && (
          <div
            id={lectureToolsId}
            className="conversation-settings lecture-tools"
            role="group"
            aria-label="Additional lecture controls"
            hidden={!showAllControls}
          >
            <LectureTools
              active={active && isLecture}
              onSetLanguages={onSetLanguages}
              translatorPicker={translatorPicker}
              lecture={lecture}
              lectureState={lectureState}
              isDark={isDark}
              fontSize={fontSize}
              onAdjustFont={onAdjustFont}
              activeRoomCode={activeRoomCode}
              effectiveLectureLang={effectiveLectureLang}
              setLecturePlaybackLang={setLecturePlaybackLang}
              lectureLangs={lectureLangs}
              voicePrefs={voicePrefs}
              updateVoicePref={updateVoicePref}
              lectureReadAloud={lectureReadAloud}
              setLectureReadAloud={setLectureReadAloud}
              settings={settings}
              setSettings={setSettings}
              fileMenuExtras={driveArchive('oh-menu-item')}
            />
          </div>
        )}
      </div>
      {isLecture && (
        <>
          {lecturePlayback.status !== 'idle' && (
            <div className="conversation-settings" role="group" aria-label="Active audio playback">
              <PlaybackToolbar
                status={lecturePlayback.status}
                downloadProgress={lecturePlayback.downloadProgress}
                onTogglePause={lecturePlayback.togglePause}
                onStop={lecturePlayback.stop}
              />
            </div>
          )}
        </>
      )}
    </>
  );
}
