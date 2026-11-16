import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cloud, FolderOpen, FolderPlus, RefreshCw, X } from 'lucide-react';
import {
  AUTO_DEFAULT_FOLDER_ID,
  DEFAULT_DRIVE_FOLDER_NAME,
  normalizeJsonFileName,
  replacesLastSave,
  type DriveAccount,
  type DriveFolderRef,
  type SavedDriveFile,
} from '../lib/googleDrive';

interface DriveSaveModalProps {
  open: boolean;
  initialFileName: string;
  folder: DriveFolderRef;
  account: DriveAccount | null;
  lastSave: SavedDriveFile | null;
  busy?: boolean;
  statusMessage?: string | null;
  error?: string | null;
  onChangeFolder: () => void | Promise<void>;
  onCreateFolder: (name: string) => void | Promise<void>;
  onSwitchAccount: () => void | Promise<void>;
  onConfirm: (fileName: string, mode: 'update' | 'new-copy') => void | Promise<void>;
  onClose: () => void;
}

export const DriveSaveModal: React.FC<DriveSaveModalProps> = ({
  open,
  initialFileName,
  folder,
  account,
  lastSave,
  busy = false,
  statusMessage = null,
  error = null,
  onChangeFolder,
  onCreateFolder,
  onSwitchAccount,
  onConfirm,
  onClose,
}) => {
  const [fileName, setFileName] = useState(initialFileName);
  const [saveAsNewCopy, setSaveAsNewCopy] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState(DEFAULT_DRIVE_FOLDER_NAME);

  useEffect(() => {
    if (!open) return;
    setFileName(initialFileName);
    setSaveAsNewCopy(false);
    setCreatingFolder(false);
    setNewFolderName(DEFAULT_DRIVE_FOLDER_NAME);
  }, [open, initialFileName]);

  if (!open) return null;

  const isAutoDefaultFolder = folder.id === AUTO_DEFAULT_FOLDER_ID;
  const canUpdateExisting = replacesLastSave(lastSave, folder.id, fileName);
  const effectiveMode: 'update' | 'new-copy' = canUpdateExisting && !saveAsNewCopy ? 'update' : 'new-copy';
  const normalizedPreview = normalizeJsonFileName(fileName);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !fileName.trim()) return;
    void onConfirm(normalizedPreview, effectiveMode);
  };

  const handleCreateFolderSubmit = () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || busy) return;
    setCreatingFolder(false);
    void onCreateFolder(trimmed);
  };

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drive-save-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-[#E2E8F0] dark:border-[#1E293B] bg-white dark:bg-[#0F172A] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E2E8F0] dark:border-[#1E293B]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#EEF2FF] dark:bg-[#1E1B4B] flex items-center justify-center text-[#5843A5] dark:text-[#A78BFA]">
              <Cloud className="w-4 h-4" />
            </div>
            <div>
              <h2
                id="drive-save-modal-title"
                className="text-sm font-bold text-[#0F172A] dark:text-[#F8FAFC]"
              >
                Save lecture to Google Drive
              </h2>
              <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8]">
                Portable OverHeard JSON (no room PINs or teacher credentials)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close Google Drive save modal"
            className="p-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] dark:hover:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 rounded-xl border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#020617] px-3 py-2">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-[#94A3B8]">
                Google Account
              </div>
              <div className="text-xs font-medium text-[#0F172A] dark:text-[#F8FAFC] truncate">
                {account?.email || account?.name || 'Signed in with Google'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => void onSwitchAccount()}
              disabled={busy}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold text-[#5843A5] dark:text-[#A78BFA] hover:bg-[#EEF2FF] dark:hover:bg-[#1E1B4B]/60 transition-colors whitespace-nowrap disabled:opacity-50"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Switch account</span>
            </button>
          </div>

          <div>
            <label
              htmlFor="drive-save-filename"
              className="block text-xs font-semibold text-[#0F172A] dark:text-[#F8FAFC] mb-1.5"
            >
              File name
            </label>
            <input
              id="drive-save-filename"
              type="text"
              value={fileName}
              onChange={(e) => setFileName(e.target.value)}
              disabled={busy}
              className="w-full rounded-xl border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#020617] px-3 py-2 text-xs text-[#0F172A] dark:text-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#5843A5] disabled:opacity-60"
              placeholder="Lecture.json"
            />
            <p className="mt-1 text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
              Will save as <span className="font-medium text-[#0F172A] dark:text-[#F8FAFC]">{normalizedPreview}</span>
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#0F172A] dark:text-[#F8FAFC]">
                Drive folder
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void onChangeFolder()}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#CBD5E1] dark:border-[#334155] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <FolderOpen className="w-3 h-3" />
                  <span>Change...</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCreatingFolder((v) => !v)}
                  disabled={busy}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border border-[#CBD5E1] dark:border-[#334155] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>New folder...</span>
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#E2E8F0] dark:border-[#1E293B] bg-[#F8FAFC] dark:bg-[#020617] px-3 py-2">
              <div className="text-xs font-medium text-[#0F172A] dark:text-[#F8FAFC]">
                {folder.name}
              </div>
              {isAutoDefaultFolder && (
                <div className="text-[11px] text-[#64748B] dark:text-[#94A3B8] mt-0.5">
                  Automatically creates or reuses "{DEFAULT_DRIVE_FOLDER_NAME}" in My Drive when saving.
                </div>
              )}
            </div>

            {creatingFolder && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  disabled={busy}
                  aria-label="New Drive folder name"
                  placeholder={DEFAULT_DRIVE_FOLDER_NAME}
                  className="flex-1 rounded-lg border border-[#CBD5E1] dark:border-[#334155] bg-white dark:bg-[#020617] px-2.5 py-1.5 text-xs text-[#0F172A] dark:text-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#5843A5]"
                />
                <button
                  type="button"
                  onClick={handleCreateFolderSubmit}
                  disabled={busy || !newFolderName.trim()}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#5843A5] hover:bg-[#49368F] text-white transition-colors disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            )}
          </div>

          {canUpdateExisting && lastSave && (
            <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 px-3 py-2.5 space-y-2">
              <div className="text-xs font-medium text-[#0F172A] dark:text-[#F8FAFC]">
                A saved copy named <span className="font-semibold">{lastSave.name}</span> already exists in{' '}
                <span className="font-semibold">{lastSave.folderName}</span>.
              </div>
              <div className="flex items-center gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#0F172A] dark:text-[#F8FAFC]">
                  <input
                    type="radio"
                    name="drive-save-mode"
                    checked={!saveAsNewCopy}
                    onChange={() => setSaveAsNewCopy(false)}
                    disabled={busy}
                  />
                  <span>Update existing file</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer text-[#0F172A] dark:text-[#F8FAFC]">
                  <input
                    type="radio"
                    name="drive-save-mode"
                    checked={saveAsNewCopy}
                    onChange={() => setSaveAsNewCopy(true)}
                    disabled={busy}
                  />
                  <span>Save as new copy</span>
                </label>
              </div>
            </div>
          )}

          {statusMessage && (
            <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-200">
              {statusMessage}
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E2E8F0] dark:border-[#1E293B]">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold border border-[#CBD5E1] dark:border-[#334155] text-[#0F172A] dark:text-[#F8FAFC] hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || !fileName.trim()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-[#5843A5] hover:bg-[#49368F] text-white transition-colors disabled:opacity-50"
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>{busy ? 'Saving...' : effectiveMode === 'update' ? 'Update in Drive' : 'Save to Drive'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return typeof document !== 'undefined' && document.body
    ? createPortal(modalContent, document.body)
    : modalContent;
};
