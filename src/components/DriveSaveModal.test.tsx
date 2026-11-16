// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriveSaveModal } from './DriveSaveModal';
import { OpenFromDriveButton, SaveLectureToDriveControl } from './DriveLectureActions';
import { DEFAULT_AUTO_FOLDER, DEFAULT_DRIVE_FOLDER_NAME, resetDriveStateForTests } from '../lib/googleDrive';
import { roomJson } from '../rooms/protocol';

beforeEach(() => {
  localStorage.clear();
  resetDriveStateForTests();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete window.google;
});

describe('DriveSaveModal', () => {
  it('defaults folder to OverHeard Saves and supports update vs new-copy choice', () => {
    const onConfirm = vi.fn();
    const onCreateFolder = vi.fn();
    const onChangeFolder = vi.fn();
    const onSwitchAccount = vi.fn();

    const { rerender } = render(
      <DriveSaveModal
        open
        initialFileName="Lecture for room-1 on Monday, November 16th, 2026.json"
        folder={DEFAULT_AUTO_FOLDER}
        account={{ id: 'u1', email: 'teacher@school.edu', name: 'Ms. Diaz' }}
        lastSave={null}
        onChangeFolder={onChangeFolder}
        onCreateFolder={onCreateFolder}
        onSwitchAccount={onSwitchAccount}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText('teacher@school.edu')).toBeTruthy();
    expect(screen.getByText(DEFAULT_DRIVE_FOLDER_NAME)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /New folder/i }));
    const folderInput = screen.getByLabelText('New Drive folder name') as HTMLInputElement;
    expect(folderInput.value).toBe(DEFAULT_DRIVE_FOLDER_NAME);
    fireEvent.change(folderInput, { target: { value: 'Period 3 Chemistry' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onCreateFolder).toHaveBeenCalledWith('Period 3 Chemistry');

    fireEvent.click(screen.getByRole('button', { name: /Switch account/i }));
    expect(onSwitchAccount).toHaveBeenCalledTimes(1);

    // Rerender with matching prior save in a resolved folder
    rerender(
      <DriveSaveModal
        open
        initialFileName="Chem Day 1.json"
        folder={{ id: 'folder-1', name: 'Period 3 Chemistry' }}
        account={{ id: 'u1', email: 'teacher@school.edu', name: 'Ms. Diaz' }}
        lastSave={{
          id: 'drive-99',
          name: 'Chem Day 1.json',
          folderId: 'folder-1',
          folderName: 'Period 3 Chemistry',
        }}
        onChangeFolder={onChangeFolder}
        onCreateFolder={onCreateFolder}
        onSwitchAccount={onSwitchAccount}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Update in Drive/i })).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Save as new copy'));
    fireEvent.click(screen.getByRole('button', { name: /Save to Drive/i }));
    expect(onConfirm).toHaveBeenCalledWith('Chem Day 1.json', 'new-copy');
  });
});

describe('DriveLectureActions', () => {
  it('saves a lecture into auto-created OverHeard Saves folder and opens a lecture from Drive', async () => {
    const sampleJson = roomJson({
      selectedLangs: ['es'],
      entries: [
        {
          id: 'lec-1',
          english: 'Welcome to class everyone.',
          translations: { es: 'Bienvenidos a clase todos.' },
          failedLangs: {},
          timestamp: 1000,
        },
      ],
    });

    window.google = {
      accounts: {
        oauth2: {
          initTokenClient: (config) => ({
            requestAccessToken: () => config.callback({ access_token: 'tok-123', expires_in: 3600 }),
          }),
        },
      },
      picker: {
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        ViewId: { DOCS: 'docs', FOLDERS: 'folders' },
        DocsView: class {
          setMimeTypes() { return this; }
          setIncludeFolders() { return this; }
          setSelectFolderEnabled() { return this; }
          setLabel() { return this; }
          setOwnedByMe() { return this; }
          setParent() { return this; }
        },
        PickerBuilder: class {
          private cb: ((data: { action: string; docs?: Array<{ id: string; name?: string }> }) => void) | null = null;
          addView() { return this; }
          setOAuthToken() { return this; }
          setDeveloperKey() { return this; }
          setAppId() { return this; }
          setOrigin() { return this; }
          setTitle() { return this; }
          setCallback(cb: (data: { action: string; docs?: Array<{ id: string; name?: string }> }) => void) {
            this.cb = cb;
            return this;
          }
          build() {
            return {
              setVisible: () => {
                this.cb?.({
                  action: 'picked',
                  docs: [{ id: 'picked-json-1', name: 'Saved Class.json' }],
                });
              },
            };
          }
        },
      },
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/drive/v3/about')) {
        return new Response(
          JSON.stringify({ user: { displayName: 'Prof', emailAddress: 'prof@school.edu', permissionId: 'p1' } }),
          { status: 200 },
        );
      }
      if (url.includes('/drive/v3/files?q=')) {
        return new Response(JSON.stringify({ files: [] }), { status: 200 });
      }
      if (url.includes('/drive/v3/files?fields=id,name') && init?.method === 'POST') {
        return new Response(JSON.stringify({ id: 'oh-folder-1', name: 'OverHeard Saves' }), { status: 200 });
      }
      if (url.includes('/upload/drive/v3/files')) {
        return new Response(JSON.stringify({ id: 'saved-1', name: 'Biology.json' }), { status: 200 });
      }
      if (url.includes('/drive/v3/files/picked-json-1?fields=')) {
        return new Response(JSON.stringify({ id: 'picked-json-1', name: 'Saved Class.json', size: '512' }), {
          status: 200,
        });
      }
      if (url.includes('/drive/v3/files/picked-json-1?alt=media')) {
        return new Response(sampleJson, { status: 200 });
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    const onImport = vi.fn();
    const onError = vi.fn();
    render(
      <div>
        <SaveLectureToDriveControl
          state={{
            selectedLangs: ['es'],
            entries: [
              {
                id: 'lec-1',
                english: 'Welcome to class everyone.',
                translations: { es: 'Bienvenidos.' },
                failedLangs: {},
                timestamp: 1000,
              },
            ],
          }}
          onSaved={onSaved}
          onError={onError}
        />
        <OpenFromDriveButton onImport={onImport} onError={onError} />
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save to Drive' }));
    const dialog = await screen.findByRole('dialog');

    fireEvent.change(within(dialog).getByLabelText('File name'), { target: { value: 'Biology.json' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Save to Drive/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(onSaved.mock.calls[0]?.[0]).toMatchObject({
      file: { id: 'saved-1', name: 'Biology.json', folderId: 'oh-folder-1', folderName: 'OverHeard Saves' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Open from Drive' }));
    await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    expect(onImport.mock.calls[0]?.[0].entries).toHaveLength(1);
    expect(onImport.mock.calls[0]?.[0].selectedLangs).toEqual(['es']);
  });
});
