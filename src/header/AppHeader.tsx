import { type ComponentProps, type ReactNode, type Dispatch, type SetStateAction } from 'react';
import type { DisplayMode, CaptionSegment, LanguageCode } from '../types';
import { FlaskConical, Globe, HelpCircle, History, Moon, PictureInPicture2, Settings, Sun } from 'lucide-react';
import { PackProgressPanel } from '../components/PackProgressPanel';
import { WhiteboatIcon } from '../components/WhiteboatIcon';
import { JoinRoomForm } from '../rooms/StudentRoom';
import type { parseRoomJson } from '../rooms/protocol';
import { TestInputBar } from '../captions/TestInputBar';
import { ListenButton } from './ListenButton';
import { FontSizeControls } from './FontSizeControls';
import { ClearTranscriptButton } from './ClearTranscriptButton';
import { DisplayModeSwitch } from './DisplayModeSwitch';
import { FileMenu } from './FileMenu';

interface AppHeaderProps {
  selectedLangs: LanguageCode[];
  isDark: boolean;
  hasPipApi: boolean;
  showPreviousLine: boolean;
  isTestBarOpen: boolean;
  packProgress: Record<string, number>;
  packStartedAt: number | null;
  segments: CaptionSegment[];
  pipWindow: Window | null;
  speechStatusNotice: string | null;
  translatorPicker: ReactNode;
  applyImportedLecture: (imported: ReturnType<typeof parseRoomJson>) => void;
  setIsDark: Dispatch<SetStateAction<boolean>>;
  setIsTestBarOpen: Dispatch<SetStateAction<boolean>>;
  setShowPreviousLine: Dispatch<SetStateAction<boolean>>;
  setDisplayMode: (mode: DisplayMode) => void;
  handleTogglePip: () => Promise<void>;
  setImportError: (text: string) => void;
  setIsVoiceSettingsOpen: (open: boolean) => void;
  setIsLangModalOpen: (open: boolean) => void;
  setIsAboutModalOpen: (open: boolean) => void;
  handleExportJson: () => void;
  listen: ComponentProps<typeof ListenButton>;
  sizing: ComponentProps<typeof FontSizeControls>;
  modes: ComponentProps<typeof DisplayModeSwitch>;
  clear: ComponentProps<typeof ClearTranscriptButton> & { segments: CaptionSegment[]; interimTranscript: string };
  testInput: ComponentProps<typeof TestInputBar>;
}

export function AppHeader({
  selectedLangs, isDark, hasPipApi, showPreviousLine, isTestBarOpen, packProgress,
  packStartedAt, segments, pipWindow, speechStatusNotice, translatorPicker,
  applyImportedLecture, setIsDark, setIsTestBarOpen, setShowPreviousLine, setDisplayMode,
  handleTogglePip, setImportError, setIsVoiceSettingsOpen, setIsLangModalOpen,
  setIsAboutModalOpen, handleExportJson, listen, sizing, modes, clear, testInput,
}: AppHeaderProps) {
  return (
    <header className="oh-chrome-bar border-b border-[#CBD5E1] dark:border-[#243044] bg-white dark:bg-[#111827] px-4 lg:px-6 py-3">
      {/* Two rows: brand, Listen and display controls; then translation and session controls */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        {/* Left: Brand & Primary Start/Stop Mic Action */}
        <div className="flex items-center gap-3 xl:gap-4">
          <button
            type="button"
            onClick={() => setDisplayMode('columns')}
            aria-label="OverHeard — Go to Columns view"
            title="Back to main Columns view"
            className="flex items-center gap-2.5 shrink-0 cursor-pointer rounded-[2px] px-1 py-0.5 -mx-1 hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5843A5] dark:focus-visible:ring-[#A78BFA] transition-opacity"
          >
            <WhiteboatIcon app="overheard" size={28} />
            <span className="text-xl font-extrabold tracking-tight text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap">
              OverHeard
            </span>
          </button>

          {/* Primary Start/Stop Button + Pulsing Mic Indicator */}
          <ListenButton {...listen} />

          {speechStatusNotice && (
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              {speechStatusNotice}
            </span>
          )}

          <PackProgressPanel progress={packProgress} startedAt={packStartedAt} />
        </div>

          {/* Display: how captions look on the projector */}
          <div className="flex flex-wrap items-center gap-2">
            <FontSizeControls {...sizing} />
            <button
              type="button"
              onClick={() => setShowPreviousLine((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border transition-colors whitespace-nowrap ${
                showPreviousLine
                  ? 'oh-btn-active border-[#5843A5] dark:border-[#A78BFA] bg-[#EDE9FE] dark:bg-[#2E2356] text-[#443180] dark:text-[#DDD6FE]'
                  : 'oh-btn border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#475569] dark:text-[#CBD5E1] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] hover:text-[#0F172A] dark:hover:text-white'
              }`}
              title="Show or hide the preceding caption line"
            >
              <History className="w-3.5 h-3.5" />
              <span>Prev Line</span>
            </button>
            <DisplayModeSwitch {...modes} />
            {hasPipApi && (
              <button
                type="button"
                onClick={handleTogglePip}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border transition-colors whitespace-nowrap ${
                  pipWindow
                    ? 'border-emerald-600 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'oh-btn oh-beckon border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B]'
                }`}
                title="Open floating always-on-top caption window over slides"
                aria-label={pipWindow ? 'Close Pop-out' : 'Pop out captions'}
              >
                <PictureInPicture2 className={`w-3.5 h-3.5 ${pipWindow ? '' : 'text-[#D97706] dark:text-[#FACC15]'}`} />
                <span className="hidden xl:inline">{pipWindow ? 'Close Pop-out' : 'Pop out captions'}</span>
              </button>
            )}
          </div>

        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* Translation: which languages, which translator */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsLangModalOpen(true)}
              aria-label={`Languages (${selectedLangs.join(', ')})`}
              title="Choose which languages the captions are translated into"
              className="oh-btn oh-beckon inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] transition-colors whitespace-nowrap"
            >
              <Globe className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
              <span className="hidden 2xl:inline">Languages</span>
              <span className="px-1.5 py-px rounded-[2px] bg-[#EAEFF6] dark:bg-[#0B111C] text-[10.5px] font-bold uppercase tracking-wide text-[#475569] dark:text-[#A5B4CB]">
                {selectedLangs.join(' · ')}
              </span>
            </button>
            {translatorPicker}
            <button
              type="button"
              onClick={() => setIsVoiceSettingsOpen(true)}
              className="oh-btn oh-settings-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs border transition-colors whitespace-nowrap"
              title="Open voice and privacy settings"
              aria-label="Settings"
            >
              <Settings className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Settings</span>
            </button>
          </div>

          {/* Session: join a room, lecture file, testing, theme, help */}
          <div className="flex flex-wrap items-center gap-2">
            <JoinRoomForm />
            <FileMenu
              canExport={segments.length > 0}
              canClear={clear.segments.length > 0 || !!clear.interimTranscript}
              applyImportedLecture={applyImportedLecture}
              setImportError={setImportError}
              handleExportJson={handleExportJson}
              requestClear={() => clear.setConfirmClear(true)}
            />
            <ClearTranscriptButton {...clear} />
            <button
              type="button"
              onClick={() => setIsTestBarOpen((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border transition-colors whitespace-nowrap ${
                isTestBarOpen
                  ? 'oh-btn-active border-[#5843A5] dark:border-[#A78BFA] bg-[#EDE9FE] dark:bg-[#2E2356] text-[#443180] dark:text-[#DDD6FE]'
                  : 'oh-btn border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#475569] dark:text-[#CBD5E1] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] hover:text-[#0F172A] dark:hover:text-white'
              }`}
              title="Toggle silent text input & sample classroom phrases"
              aria-label="Test Input"
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">Test Input</span>
            </button>
            <button
              type="button"
              onClick={() => setIsDark((d) => !d)}
              className="oh-btn p-2 rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#475569] dark:text-[#CBD5E1] hover:text-[#0F172A] dark:hover:text-white hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] transition-colors"
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setIsAboutModalOpen(true)}
              className="oh-btn p-2 rounded-[2px] border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#5843A5] dark:text-[#A78BFA] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B] transition-colors"
              aria-label="How to use OverHeard: Guide, FAQ, and Privacy"
              title="Guide & FAQ: how to use OverHeard, plus the privacy notice"
            >
              <HelpCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible Silent Test Input Bar */}
      {isTestBarOpen && (
        <TestInputBar {...testInput} />
      )}
    </header>
  );
}
