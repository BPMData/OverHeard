import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Download, FolderOpen, Trash2, Upload } from 'lucide-react';
import { parseRoomJson, MAX_ROOM_FILE_BYTES } from '../rooms/protocol';
import { loadLectureEntries } from '../conversation/lectureState';
import { OpenFromDriveButton } from '../components/DriveLectureActions';

interface FileMenuProps {
  canExport: boolean;
  canClear: boolean;
  applyImportedLecture: (imported: ReturnType<typeof parseRoomJson>) => void;
  setImportError: (text: string) => void;
  handleExportJson: () => void;
  /** Opens the inline "Clear all?" confirmation in the toolbar */
  requestClear: () => void;
}

const ITEM =
  'w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-semibold rounded-[2px] text-[#0F172A] dark:text-[#E2E8F0] hover:bg-[#EDE9FE] dark:hover:bg-[#2E2356] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent transition-colors whitespace-nowrap';
const ICON = 'w-3.5 h-3.5 text-[#5843A5] dark:text-[#A78BFA]';

/** Import, open, export and clear: lecture-file actions a teacher needs now and then, not every minute. */
export function FileMenu({
  canExport, canClear, applyImportedLecture, setImportError, handleExportJson, requestClear,
}: FileMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border transition-colors whitespace-nowrap ${
          open
            ? 'oh-btn-active border-[#5843A5] dark:border-[#A78BFA] bg-[#EDE9FE] dark:bg-[#2E2356] text-[#443180] dark:text-[#DDD6FE]'
            : 'oh-btn border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-[#EDF2F7] dark:hover:bg-[#1E293B]'
        }`}
        title="Import, export, or clear the lecture transcript"
      >
        <FolderOpen className={ICON} aria-hidden="true" />
        <span>File</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {/* Kept mounted while closed so a Drive pick in progress survives the menu closing */}
      <div
        hidden={!open}
        className="absolute right-0 top-full mt-1 z-40 min-w-[200px] p-1 rounded-[3px] border border-[#CBD5E1] dark:border-[#2B3952] bg-white dark:bg-[#111827] shadow-lg shadow-black/20 dark:shadow-black/50"
      >
        <button
          type="button"
          className={ITEM}
          onClick={() => {
            setOpen(false);
            importFileInputRef.current?.click();
          }}
          title="Open an exported OverHeard lecture JSON file"
        >
          <Upload className={ICON} aria-hidden="true" />
          <span>Import JSON</span>
        </button>
        <OpenFromDriveButton
          hasExistingEntries={() => loadLectureEntries().length > 0}
          onImport={(imported) => {
            setOpen(false);
            applyImportedLecture(imported);
          }}
          onError={(msg) => setImportError(msg)}
          className={ITEM}
          iconClassName={ICON}
        />
        <button
          type="button"
          className={ITEM}
          onClick={() => {
            setOpen(false);
            try {
              handleExportJson();
              setImportError('');
            } catch (err) {
              setImportError(err instanceof Error ? err.message : 'Could not export the transcript.');
            }
          }}
          disabled={!canExport}
          title="Export transcript as OverHeard JSON"
        >
          <Download className={ICON} aria-hidden="true" />
          <span>Export JSON</span>
        </button>
        <div className="my-1 h-px bg-[#E2E8F0] dark:bg-[#243044]" role="separator" />
        <button
          type="button"
          className={`${ITEM} hover:!text-red-600 dark:hover:!text-red-400`}
          onClick={() => {
            setOpen(false);
            requestClear();
          }}
          disabled={!canClear}
          title="Clear captions and transcript"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Clear</span>
        </button>
      </div>

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
    </div>
  );
}
