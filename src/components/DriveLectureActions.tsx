import React, { useState } from 'react';
import { Cloud, CloudDownload } from 'lucide-react';
import { formatLectureFilename } from '../rooms/LectureFiles';
import { parseRoomJson, roomJson, type LectureState } from '../rooms/protocol';
import { isGoogleDriveConfigured } from '../lib/googleConfig';
import {
  createDriveFolder,
  downloadDriveJsonFile,
  ensureDriveSession,
  friendlyGoogleError,
  getDefaultDriveFolderSelection,
  getRoomDriveSave,
  pickDriveFolder,
  pickDriveJsonFile,
  saveLectureJsonToDrive,
  setLastDriveFolder,
  switchGoogleAccount,
  type DriveAccount,
  type DriveFolderRef,
  type PickedDriveFile,
  type SavedDriveFile,
  type SaveLectureToDriveResult,
} from '../lib/googleDrive';
import { DriveSaveModal } from './DriveSaveModal';

type ParsedLecture = Pick<LectureState, 'entries' | 'selectedLangs'>;

interface OpenFromDriveButtonProps {
  onImport: (imported: ParsedLecture, file: PickedDriveFile) => void;
  hasExistingEntries?: () => boolean;
  onError?: (message: string) => void;
  className?: string;
  iconClassName?: string;
  label?: string;
}

export const OpenFromDriveButton: React.FC<OpenFromDriveButtonProps> = ({
  onImport,
  hasExistingEntries,
  onError,
  className,
  iconClassName,
  label = 'Open from Drive',
}) => {
  const [busy, setBusy] = useState(false);
  if (!isGoogleDriveConfigured()) return null;

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ensureDriveSession();
      const picked = await pickDriveJsonFile();
      if (!picked) return;
      const downloaded = await downloadDriveJsonFile(picked.id);
      const imported = parseRoomJson(downloaded.content);
      if (
        hasExistingEntries?.() &&
        !window.confirm(
          `Replace the current lecture with "${downloaded.name}" from Google Drive? Export or save first to keep the current transcript.`,
        )
      ) {
        return;
      }
      onError?.('');
      onImport(imported, { ...picked, name: downloaded.name || picked.name });
    } catch (err) {
      onError?.(friendlyGoogleError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy}
      className={className}
      title="Open a saved OverHeard lecture JSON file from Google Drive"
    >
      <CloudDownload className={iconClassName ?? 'w-3.5 h-3.5'} />
      <span>{busy ? 'Opening...' : label}</span>
    </button>
  );
};

interface SaveLectureToDriveControlProps {
  state: Pick<LectureState, 'entries' | 'selectedLangs'>;
  roomCode?: string | null;
  onSaved?: (result: SaveLectureToDriveResult) => void;
  onError?: (message: string) => void;
  className?: string;
}

export const SaveLectureToDriveControl: React.FC<SaveLectureToDriveControlProps> = ({
  state,
  roomCode,
  onSaved,
  onError,
  className,
}) => {
  const [modalOpen, setModalOpen] = useState(false);
  const [openingAuth, setOpeningAuth] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [account, setAccount] = useState<DriveAccount | null>(null);
  const [folder, setFolder] = useState<DriveFolderRef>(() => getDefaultDriveFolderSelection(null));
  const [lastSave, setLastSave] = useState<SavedDriveFile | null>(null);
  const [initialFileName, setInitialFileName] = useState(() => formatLectureFilename(roomCode));

  if (!isGoogleDriveConfigured()) return null;

  const saveKey = roomCode?.trim() || 'local';

  const handleOpenModal = async () => {
    if (openingAuth || state.entries.length === 0) return;
    setOpeningAuth(true);
    onError?.('');
    setModalError(null);
    try {
      const activeAccount = await ensureDriveSession();
      setAccount(activeAccount);
      setFolder(getDefaultDriveFolderSelection(activeAccount));
      setLastSave(getRoomDriveSave(saveKey, activeAccount));
      setInitialFileName(formatLectureFilename(roomCode));
      setModalOpen(true);
    } catch (err) {
      onError?.(friendlyGoogleError(err));
    } finally {
      setOpeningAuth(false);
    }
  };

  const handleChangeFolder = async () => {
    setBusy(true);
    setModalError(null);
    try {
      const picked = await pickDriveFolder();
      if (picked) {
        setFolder(picked);
        setLastDriveFolder(picked, account);
      }
    } catch (err) {
      setModalError(friendlyGoogleError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFolder = async (name: string) => {
    setBusy(true);
    setModalError(null);
    try {
      const created = await createDriveFolder(name, 'root');
      setFolder(created);
      setLastDriveFolder(created, account);
    } catch (err) {
      setModalError(friendlyGoogleError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSwitchAccount = async () => {
    setBusy(true);
    setModalError(null);
    try {
      const nextAccount = await switchGoogleAccount();
      setAccount(nextAccount);
      setFolder(getDefaultDriveFolderSelection(nextAccount));
      setLastSave(getRoomDriveSave(saveKey, nextAccount));
    } catch (err) {
      setModalError(friendlyGoogleError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (fileName: string, mode: 'update' | 'new-copy') => {
    setBusy(true);
    setModalError(null);
    try {
      const result = await saveLectureJsonToDrive({
        fileName,
        jsonContent: roomJson(state),
        folder,
        saveKey,
        updateFileId: mode === 'update' ? lastSave?.id : undefined,
        account,
      });
      setFolder(result.folder);
      setLastSave(result.file);
      setModalOpen(false);
      onSaved?.(result);
    } catch (err) {
      setModalError(friendlyGoogleError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleOpenModal()}
        disabled={openingAuth || state.entries.length === 0}
        className={className}
        title="Save this lecture JSON to Google Drive"
      >
        <Cloud className="w-3.5 h-3.5" />
        <span>{openingAuth ? 'Connecting...' : 'Save to Drive'}</span>
      </button>

      <DriveSaveModal
        open={modalOpen}
        initialFileName={initialFileName}
        folder={folder}
        account={account}
        lastSave={lastSave}
        busy={busy}
        error={modalError}
        onChangeFolder={handleChangeFolder}
        onCreateFolder={handleCreateFolder}
        onSwitchAccount={handleSwitchAccount}
        onConfirm={handleConfirm}
        onClose={() => {
          if (!busy) setModalOpen(false);
        }}
      />
    </>
  );
};
