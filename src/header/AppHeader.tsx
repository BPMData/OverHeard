import { type ComponentProps, type ReactNode, type Dispatch, type SetStateAction, useRef } from 'react';
import type { DisplayMode, CaptionSegment, LanguageCode } from '../types';
import { Download, FlaskConical, Globe, HelpCircle, History, Moon, PictureInPicture2, Sun, Upload, Volume2 } from 'lucide-react';
import { PackProgressPanel } from '../components/PackProgressPanel';
import { WhiteboatIcon } from '../components/WhiteboatIcon';
import { JoinRoomForm } from '../rooms/StudentRoom';
import { parseRoomJson, MAX_ROOM_FILE_BYTES } from '../rooms/protocol';
import { loadLectureEntries } from '../conversation/lectureState';
import { OpenFromDriveButton } from '../components/DriveLectureActions';
import { TestInputBar } from '../captions/TestInputBar';
import { ListenButton } from './ListenButton';
import { FontSizeControls } from './FontSizeControls';
import { ClearTranscriptButton } from './ClearTranscriptButton';
import { DisplayModeSwitch } from './DisplayModeSwitch';

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
  clear: ComponentProps<typeof ClearTranscriptButton>;
  testInput: ComponentProps<typeof TestInputBar>;
}

export function AppHeader({
  selectedLangs, isDark, hasPipApi, showPreviousLine, isTestBarOpen, packProgress,
  packStartedAt, segments, pipWindow, speechStatusNotice, translatorPicker,
  applyImportedLecture, setIsDark, setIsTestBarOpen, setShowPreviousLine, setDisplayMode,
  handleTogglePip, setImportError, setIsVoiceSettingsOpen, setIsLangModalOpen,
  setIsAboutModalOpen, handleExportJson, listen, sizing, modes, clear, testInput,
}: AppHeaderProps) {
  const importFileInputRef = useRef<HTMLInputElement>(null);

  return (
    <header className="border-b border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#111827] px-4 lg:px-6 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: Brand & Primary Start/Stop Mic Action */}
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setDisplayMode('columns')}
            aria-label="OverHeard — Go to Columns view"
            title="Back to main Columns view"
            className="flex items-center gap-2.5 shrink-0 cursor-pointer rounded-lg px-1 py-0.5 -mx-1 hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5843A5] dark:focus-visible:ring-[#A78BFA] transition-opacity"
          >
            <WhiteboatIcon app="overheard" size={28} className="shadow-2xs" />
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

        {/* Right: Projector Display & Classroom Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Font Size A- / A+ */}
          <FontSizeControls {...sizing} />

          {/* Show Previous Line Toggle */}
          <button
            type="button"
            onClick={() => setShowPreviousLine((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              showPreviousLine
                ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#5843A5]/10 dark:bg-[#5843A5]/25 text-[#5843A5] dark:text-[#DDD6FE]'
                : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
            title="Show or hide the preceding caption line"
          >
            <History className="w-3.5 h-3.5" />
            <span>Prev Line</span>
          </button>

          {/* Columns vs Subtitle Mode */}
          <DisplayModeSwitch {...modes} />

          <JoinRoomForm />
          <button
            type="button"
            onClick={() => importFileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            title="Open an exported OverHeard lecture JSON file"
          >
            <Upload className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
            <span>Import JSON</span>
          </button>
          <input
            ref={importFileInputRef}
            type="file"
            accept=".json,application/json"
            aria-label="Import lecture JSON on home screen"
            hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              try {
                if (file.size > MAX_ROOM_FILE_BYTES) {
                  throw new Error('Room file is too large (8 MB maximum).');
                }
                const raw =
                  typeof file.text === 'function' ? await file.text() : await new Response(file).text();
                const imported = parseRoomJson(raw);
                if (
                  loadLectureEntries().length > 0 &&
                  !window.confirm(
                    'Replace the saved lecture with the imported file? Export JSON first to keep the current transcript.',
                  )
                ) {
                  return;
                }
                applyImportedLecture(imported);
              } catch (err) {
                setImportError(err instanceof Error ? err.message : 'Could not read room file.');
              }
            }}
          />
          <OpenFromDriveButton
            hasExistingEntries={() => loadLectureEntries().length > 0}
            onImport={(imported) => applyImportedLecture(imported)}
            onError={(msg) => setImportError(msg)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors whitespace-nowrap"
            iconClassName="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]"
          />
          {/* Pop Out Captions (Document Picture-in-Picture) */}
          {hasPipApi && (
            <button
              type="button"
              onClick={handleTogglePip}
              className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                pipWindow
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                  : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
              title="Open floating always-on-top caption window over slides"
            >
              <PictureInPicture2 className="w-3.5 h-3.5" />
              <span>{pipWindow ? 'Close Pop-out' : 'Pop out captions'}</span>
            </button>
          )}

          {/* Languages Selector Button */}
          <button
            type="button"
            onClick={() => setIsLangModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
          >
            <Globe className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
            <span>Languages</span>
            <span className="font-mono text-[#64748B] dark:text-[#94A3B8]">
              ({selectedLangs.join(', ')})
            </span>
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={() => setIsVoiceSettingsOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            title="Open voice and translation refinement settings"
          >
            <Volume2 className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
            <span>Settings</span>
          </button>

          {/* Translator Picker (live caption provider) */}
          {translatorPicker}

          {/* Silent Test Input Bar Toggle */}
          <button
            type="button"
            onClick={() => setIsTestBarOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
              isTestBarOpen
                ? 'border-[#5843A5] dark:border-[#A78BFA] bg-[#5843A5]/10 dark:bg-[#5843A5]/25 text-[#5843A5] dark:text-[#DDD6FE]'
                : 'border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white'
            }`}
            title="Toggle silent text input & sample classroom phrases"
          >
            <FlaskConical className="w-3.5 h-3.5" />
            <span>Test Input</span>
          </button>

          {/* Light / Dark Mode Toggle */}
          <button
            type="button"
            onClick={() => setIsDark((d) => !d)}
            className="p-2 rounded-lg border border-[#E2E8F0] dark:border-[#1E293B] text-[#64748B] dark:text-[#94A3B8] hover:text-[#0F172A] dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          >
            {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* Export Transcript JSON */}
          <button
            type="button"
            onClick={handleExportJson}
            disabled={segments.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
            title="Export transcript as OverHeard JSON"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export JSON</span>
          </button>

          {/* Clear Transcript with inline confirmation */}
          <ClearTranscriptButton {...clear} />

          {/* How to Use OverHeard / Guide & FAQ Modal Button */}
          <button
            type="button"
            onClick={() => setIsAboutModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
            aria-label="How to use OverHeard: Guide, FAQ, and Privacy"
            title="How to use OverHeard: Guide, FAQ, and Privacy Notice"
          >
            <HelpCircle className="w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]" />
            <span>Guide &amp; FAQ</span>
          </button>
        </div>
      </div>

      {/* Collapsible Silent Test Input Bar */}
      {isTestBarOpen && (
        <TestInputBar {...testInput} />
      )}
    </header>
  );
}
