// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_DEFAULT_FOLDER_ID,
  DEFAULT_AUTO_FOLDER,
  DEFAULT_DRIVE_FOLDER_NAME,
  downloadDriveJsonFile,
  ensureNamedDriveFolder,
  friendlyGoogleError,
  getDefaultDriveFolderSelection,
  getLastDriveFolder,
  getRoomDriveSave,
  normalizeJsonFileName,
  replacesLastSave,
  resetDriveStateForTests,
  saveLectureJsonToDrive,
  setLastDriveFolder,
  setRoomDriveSave,
  type DriveAccount,
} from './googleDrive';

function installMockGoogleAuth(token = 'mock-access-token') {
  window.google = {
    accounts: {
      oauth2: {
        initTokenClient: (config) => ({
          requestAccessToken: () => {
            config.callback({ access_token: token, expires_in: 3600 });
          },
        }),
      },
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  resetDriveStateForTests();
  installMockGoogleAuth();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete window.google;
});

describe('googleDrive helpers', () => {
  it('normalizes json filenames safely', () => {
    expect(normalizeJsonFileName('Lecture Monday')).toBe('Lecture Monday.json');
    expect(normalizeJsonFileName('Lecture.json')).toBe('Lecture.json');
    expect(normalizeJsonFileName('Lecture.JSON')).toBe('Lecture.JSON');
    expect(normalizeJsonFileName('   ')).toBe('OverHeard Lecture.json');
  });

  it('detects when a save replaces the previous save in the same folder', () => {
    const lastSave = {
      id: 'file-1',
      name: 'Lecture.json',
      folderId: 'folder-1',
      folderName: 'OverHeard Saves',
    };
    expect(replacesLastSave(lastSave, 'folder-1', 'Lecture')).toBe(true);
    expect(replacesLastSave(lastSave, 'folder-1', 'Lecture.json')).toBe(true);
    expect(replacesLastSave(lastSave, 'folder-2', 'Lecture.json')).toBe(false);
    expect(replacesLastSave(lastSave, 'folder-1', 'Different.json')).toBe(false);
  });

  it('isolates saved folder and file metadata per Google account', () => {
    const teacherA: DriveAccount = { id: 'a', email: 'a@school.edu', name: 'Teacher A' };
    const teacherB: DriveAccount = { id: 'b', email: 'b@school.edu', name: 'Teacher B' };

    setLastDriveFolder({ id: 'folder-a', name: 'Period 1' }, teacherA);
    setRoomDriveSave(
      'room-1',
      { id: 'f-a', name: 'day1.json', folderId: 'folder-a', folderName: 'Period 1' },
      teacherA,
    );

    expect(getLastDriveFolder(teacherA)).toEqual({ id: 'folder-a', name: 'Period 1' });
    expect(getDefaultDriveFolderSelection(teacherB)).toEqual(DEFAULT_AUTO_FOLDER);
    expect(getRoomDriveSave('room-1', teacherA)?.id).toBe('f-a');
    expect(getRoomDriveSave('room-1', teacherB)).toBeNull();
  });

  it('creates "OverHeard Saves" automatically when not found in Drive', async () => {
    const account: DriveAccount = { id: 'u1', email: 'teacher@school.edu', name: 'Teacher' };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ files: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'new-folder-id', name: DEFAULT_DRIVE_FOLDER_NAME }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const folder = await ensureNamedDriveFolder(DEFAULT_DRIVE_FOLDER_NAME, account);
    expect(folder).toEqual({ id: 'new-folder-id', name: 'OverHeard Saves' });
    expect(getLastDriveFolder(account)).toEqual(folder);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const createCall = fetchMock.mock.calls[1];
    expect(createCall?.[0]).toContain('/drive/v3/files');
    expect(JSON.parse(String(createCall?.[1]?.body))).toEqual({
      name: 'OverHeard Saves',
      mimeType: 'application/vnd.google-apps.folder',
      parents: ['root'],
    });
  });

  it('auto-creates default folder on save, then updates existing file or falls back on 404', async () => {
    const account: DriveAccount = { id: 'u1', email: 'teacher@school.edu', name: 'Teacher' };
    const fetchMock = vi
      .fn()
      // 1) Folder search -> empty
      .mockResolvedValueOnce(new Response(JSON.stringify({ files: [] }), { status: 200 }))
      // 2) Folder create -> OverHeard Saves
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'folder-oh', name: 'OverHeard Saves' }), { status: 200 }),
      )
      // 3) File upload POST
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'drive-file-1',
            name: 'Bio Lecture.json',
            webViewLink: 'https://drive.google.com/file/d/drive-file-1/view',
          }),
          { status: 200 },
        ),
      )
      // 4) Update PATCH
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ id: 'drive-file-1', name: 'Bio Lecture.json' }),
          { status: 200 },
        ),
      )
      // 5) Update PATCH -> 404 (deleted in Drive), then 6) fallback POST
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'drive-file-2', name: 'Bio Lecture.json' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const first = await saveLectureJsonToDrive({
      fileName: 'Bio Lecture',
      jsonContent: '{"format":"overheard-lecture","version":1}',
      folder: { id: AUTO_DEFAULT_FOLDER_ID, name: DEFAULT_DRIVE_FOLDER_NAME },
      saveKey: 'bio-101',
      account,
    });
    expect(first.updatedExisting).toBe(false);
    expect(first.folder).toEqual({ id: 'folder-oh', name: 'OverHeard Saves' });
    expect(first.file.id).toBe('drive-file-1');

    const second = await saveLectureJsonToDrive({
      fileName: 'Bio Lecture.json',
      jsonContent: '{"format":"overheard-lecture","version":1}',
      folder: first.folder,
      saveKey: 'bio-101',
      updateFileId: first.file.id,
      account,
    });
    expect(second.updatedExisting).toBe(true);
    expect(second.file.id).toBe('drive-file-1');

    const recreated = await saveLectureJsonToDrive({
      fileName: 'Bio Lecture.json',
      jsonContent: '{"format":"overheard-lecture","version":1}',
      folder: first.folder,
      saveKey: 'bio-101',
      updateFileId: first.file.id,
      account,
    });
    expect(recreated.updatedExisting).toBe(false);
    expect(recreated.file.id).toBe('drive-file-2');
  });

  it('rejects oversized Drive downloads cleanly and translates common errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'big-1', name: 'huge.json', size: String(9 * 1024 * 1024) }), {
          status: 200,
        }),
      ),
    );
    await expect(downloadDriveJsonFile('big-1')).rejects.toThrow(/8 MB/);

    expect(friendlyGoogleError(new Error('popup_closed'))).toContain('cancelled');
    expect(friendlyGoogleError(new Error('admin_policy_enforced'))).toContain('administrator');
    expect(friendlyGoogleError(new Error('origin_mismatch'))).toContain('Google Cloud OAuth');
  });
});
