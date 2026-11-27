import { LANGUAGE_MAP } from '../constants';
import { OFFLINE_TITLE } from '../app/useOnline';
import { TwoWayReadAloud, TwoWaySettings } from './TwoWayView';
import { WhiteboatIcon } from './WhiteboatIcon';
import { HelpCircle, Maximize2, Minimize2, Moon, Settings as SettingsIcon, Sun } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { ConversationModeProps } from './ConversationMode';
import type { ConversationSettings, ConversationSubMode } from './conversationSettings';
import type { useLectureWorkspace } from '../conversation/useLectureWorkspace';
import type { useTwoWayWorkspace } from '../conversation/useTwoWayWorkspace';
import type { VoicePreferences } from '../tts/voices';
import type { ConversationLanguage, LanguageCode } from '../types';

type Common = { settings: ConversationSettings; setSettings: Dispatch<SetStateAction<ConversationSettings>>;
  voicePrefs: VoicePreferences; updateVoicePref: (lang: ConversationLanguage, voiceId: string) => void;
  showAllControls: boolean; isLecture: boolean };
type Props = Common & ReturnType<typeof useLectureWorkspace> & ReturnType<typeof useTwoWayWorkspace> &
  Pick<ConversationModeProps, 'onOpenLanguages' | 'onAdjustFont' | 'onToggleDark' | 'isDark' | 'translatorPicker'> & {
  targetLangs: LanguageCode[]; faceToFace: boolean; controlsOpen: boolean; goHome: () => void; exit: () => void;
  switchSubMode: (mode: ConversationSubMode) => void; fullscreen: boolean; toggleFullscreen: () => void;
  setIsVoiceSettingsOpen: Dispatch<SetStateAction<boolean>>; setIsGuideOpen: Dispatch<SetStateAction<boolean>>;
  returnViewName: string;
};
export function ConversationToolbar({ settings, setSettings, voicePrefs, updateVoicePref, showAllControls,
  isLecture, targetLangs, faceToFace, controlsOpen, goHome, exit, switchSubMode, fullscreen, toggleFullscreen,
  onOpenLanguages, onAdjustFont, onToggleDark, isDark, translatorPicker, setIsVoiceSettingsOpen,
  setIsGuideOpen, returnViewName, lecture, startLecture, activeRoomCode, shareSetupOpen, roomControlsId,
  online, setShareSetupOpen, roomJustEnded, speech, start, dispatch, exportJson, importJson, fileInput,
  twoWayPlayback, lectureToolsId }: Props) {
  const voiceSettingsButton = (
    <button
      type="button"
      className="conversation-settings-btn oh-settings-btn"
      onClick={() => setIsVoiceSettingsOpen(true)}
      title="Open settings: controls, reader voices, and privacy"
    >
      <SettingsIcon className="w-3.5 h-3.5" aria-hidden="true" />
      <span>Settings</span>
    </button>
  );
  return (
      <div
        className={`conversation-settings${isLecture ? ' lecture-toolbar' : ''}`}
        hidden={faceToFace && !controlsOpen}
      >
        <div className="conversation-control-group" role="group" aria-label="Workspace">
          <button
            type="button"
            className="conversation-brand"
            onClick={goHome}
            aria-label="OverHeard — Go to Columns view"
            title="Back to main Columns view"
          >
            <WhiteboatIcon app="overheard" size={22} />
            <span>OverHeard</span>
          </button>
          <div className="conversation-submode" role="group" aria-label="Conversation workspace mode">
            <button
              type="button"
              aria-pressed={!isLecture}
              className={!isLecture ? 'is-active' : ''}
              onClick={() => switchSubMode('two-way')}
            >
              Two-way
            </button>
            <button
              type="button"
              aria-pressed={isLecture}
              className={isLecture ? 'is-active' : ''}
              onClick={() => switchSubMode('lecture')}
            >
              Lecture
            </button>
          </div>
        </div>
        {isLecture ? (
          <div className="lecture-teaching-controls" role="group" aria-label="Teaching controls">
            <button
              type="button"
              className={`conversation-start ${lecture.speech.isListening ? 'is-listening' : ''}`}
              onClick={lecture.speech.isListening ? lecture.stop : startLecture}
              disabled={!lecture.speech.supported}
            >
              {lecture.speech.isListening ? 'Pause lecture' : 'Start lecture'}
            </button>
            {onOpenLanguages && (
              <button
                type="button"
                className="conversation-langs-btn oh-beckon"
                onClick={onOpenLanguages}
                aria-label={`Languages${targetLangs.length > 0 ? `: ${targetLangs.map(code => LANGUAGE_MAP[code].name).join(', ')}` : ''}`}
              >
                Languages
                <span className="oh-wide-xl">{targetLangs.length > 0 && `: ${targetLangs.map(code => LANGUAGE_MAP[code].name).join(', ')}`}</span>
                {targetLangs.length > 0 && (
                  <span className="oh-narrow-xl conversation-lang-chip">{targetLangs.map(code => code.toUpperCase()).join(' · ')}</span>
                )}
              </button>
            )}
            {!showAllControls && !activeRoomCode && (
              <button
                type="button"
                aria-expanded={shareSetupOpen}
                aria-controls={roomControlsId}
                disabled={!online}
                title={online ? undefined : OFFLINE_TITLE}
                onClick={() => setShareSetupOpen(open => !open)}
              >
                Share room code with students
              </button>
            )}
            {!showAllControls && roomJustEnded && !lecture.speech.isListening
              && (lecture.entries.length > 0 || !!lecture.speech.interim) && (
              <button type="button" onClick={lecture.clear}>
                Clear lecture
              </button>
            )}
          </div>
        ) : (
          <TwoWaySettings
            settings={settings}
            setSettings={setSettings}
            speech={speech}
            voicePrefs={voicePrefs}
            updateVoicePref={updateVoicePref}
            translatorPicker={translatorPicker}
            start={start}
            onClear={() => dispatch({ type: 'clear' })}
            exportJson={exportJson}
            importJson={importJson}
            fileInput={fileInput}
          />
        )}
        <div className="conversation-control-group" role="group" aria-label="Display settings">
          {voiceSettingsButton}
          <button
            aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            title={fullscreen ? 'Exit full screen' : 'Full screen'}
            onClick={toggleFullscreen}
          >
            <span className="oh-narrow-xl" aria-hidden="true">
              {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </span>
            <span className="oh-wide-xl">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
          </button>
          {onAdjustFont && (
            <div className="conversation-font-controls" role="group" aria-label="Text size">
              <button type="button" aria-label="Smaller conversation text" onClick={() => onAdjustFont(-4)}>
                A−
              </button>
              <button type="button" aria-label="Larger conversation text" onClick={() => onAdjustFont(4)}>
                A+
              </button>
            </div>
          )}
          {onToggleDark && (
            <button
              type="button"
              onClick={onToggleDark}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="inline-flex items-center gap-1.5"
            >
              {isDark ? <Sun className="w-3.5 h-3.5" aria-hidden="true" /> : <Moon className="w-3.5 h-3.5" aria-hidden="true" />}
              <span className="oh-wide-xl">{isDark ? 'Light' : 'Dark'}</span>
            </button>
          )}
        </div>
        {!isLecture && (
          <TwoWayReadAloud
            settings={settings}
            setSettings={setSettings}
            voicePrefs={voicePrefs}
            speech={speech}
            twoWayPlayback={twoWayPlayback}
          />
        )}
        <div className="conversation-control-group" role="group" aria-label="Navigation">
          {isLecture && !settings.alwaysShowAllLectureControls && (
            <button
              type="button"
              aria-controls={lectureToolsId}
              aria-expanded={showAllControls}
              onClick={() => setSettings(current => ({
                ...current,
                showAllLectureControls: !current.showAllLectureControls,
              }))}
              aria-label={showAllControls ? 'Use simple controls' : 'Show all controls'}
            >
              <span className="oh-wide-xl">{showAllControls ? 'Use simple controls' : 'Show all controls'}</span>
              <span className="oh-narrow-xl">{showAllControls ? 'Simple' : 'All controls'}</span>
            </button>
          )}
          <button
            type="button"
            className="conversation-exit"
            onClick={exit}
            title={`Leave ${isLecture ? 'Lecture' : 'Two-way'} and go back to ${returnViewName} view`}
            aria-label={`Back to ${returnViewName} view`}
          >
            <span aria-hidden="true">← </span><span className="oh-wide-xl">Back to </span>{returnViewName}<span className="oh-wide-xl"> view</span>
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1.5"
            onClick={() => setIsGuideOpen(true)}
            aria-label="How to use OverHeard: Guide, FAQ, and Privacy"
            title="How to use OverHeard: Guide, FAQ, and Privacy Notice"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span className="oh-wide-xl">{isLecture ? 'Help' : 'Guide & FAQ'}</span>
          </button>
        </div>
      </div>
  );
}
