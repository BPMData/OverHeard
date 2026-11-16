import { MAX_ROOM_FILE_BYTES } from '../rooms/protocol';
import { getGoogleConfig, isGoogleDriveConfigured } from './googleConfig';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const JSON_MIME = 'application/json';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const DEFAULT_DRIVE_FOLDER_NAME = 'OverHeard Saves';
export const AUTO_DEFAULT_FOLDER_ID = '__overheard_default_folder__';

export interface DriveFolderRef {
  id: string;
  name: string;
}

export const MY_DRIVE: DriveFolderRef = { id: 'root', name: 'My Drive' };

export const DEFAULT_AUTO_FOLDER: DriveFolderRef = {
  id: AUTO_DEFAULT_FOLDER_ID,
  name: DEFAULT_DRIVE_FOLDER_NAME,
};

export interface DriveAccount {
  id: string;
  email: string;
  name: string;
  picture?: string;
}

export interface SavedDriveFile {
  id: string;
  name: string;
  webViewLink?: string;
  folderId: string;
  folderName: string;
}

export interface PickedDriveFile {
  id: string;
  name: string;
  mimeType?: string;
}

export interface SaveLectureToDriveOptions {
  fileName: string;
  jsonContent: string;
  folder: DriveFolderRef;
  saveKey?: string;
  updateFileId?: string;
  account?: DriveAccount | null;
}

export interface SaveLectureToDriveResult {
  file: SavedDriveFile;
  folder: DriveFolderRef;
  updatedExisting: boolean;
}

interface TokenState {
  token: string;
  expiresAt: number;
}

interface GoogleTokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GoogleAccountsOAuth2 {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: GoogleTokenResponse) => void;
    error_callback?: (error: { type?: string; message?: string }) => void;
  }) => GoogleTokenClient;
  revoke?: (token: string, done?: () => void) => void;
}

interface GooglePickerDocument {
  id: string;
  name?: string;
  mimeType?: string;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerDocsView {
  setMimeTypes: (mimeTypes: string) => GooglePickerDocsView;
  setIncludeFolders: (include: boolean) => GooglePickerDocsView;
  setSelectFolderEnabled: (enable: boolean) => GooglePickerDocsView;
}

interface GooglePickerBuilder {
  addView: (view: GooglePickerDocsView) => GooglePickerBuilder;
  setOAuthToken: (token: string) => GooglePickerBuilder;
  setDeveloperKey: (key: string) => GooglePickerBuilder;
  setAppId: (appId: string) => GooglePickerBuilder;
  setTitle: (title: string) => GooglePickerBuilder;
  setCallback: (cb: (data: GooglePickerResponse) => void) => GooglePickerBuilder;
  build: () => { setVisible: (visible: boolean) => void };
}

interface GoogleGlobal {
  accounts?: { oauth2?: GoogleAccountsOAuth2 };
  picker?: {
    Action: { PICKED: string; CANCEL: string };
    ViewId: { DOCS: string; FOLDERS: string };
    DocsView: new (viewId?: string) => GooglePickerDocsView;
    PickerBuilder: new () => GooglePickerBuilder;
  };
}

interface GapiGlobal {
  load: (api: string, callback: { callback: () => void; onerror?: (err: unknown) => void }) => void;
}

declare global {
  interface Window {
    google?: GoogleGlobal;
    gapi?: GapiGlobal;
  }
}

const ACCOUNT_STORAGE_KEY = 'overheard_google_drive_account_v1';
const FOLDER_STORAGE_PREFIX = 'overheard_google_drive_folder_v1_';
const LAST_SAVE_STORAGE_PREFIX = 'overheard_google_drive_last_save_v1_';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const GAPI_SRC = 'https://apis.google.com/js/api.js';

let tokenState: TokenState | null = null;
let inflightTokenPromise: Promise<string> | null = null;
let cachedAccount: DriveAccount | null = null;
const scriptPromises = new Map<string, Promise<void>>();
let pickerLoadPromise: Promise<void> | null = null;

function accountKey(account?: DriveAccount | null): string {
  const active = account ?? getDriveAccount();
  return active?.id || active?.email || 'default';
}

function readStorage(key: string): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    if (value === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage quota/private mode errors.
  }
}

export function normalizeJsonFileName(name: string): string {
  const trimmed = name.trim().replace(/[\r\n\0/\\]+/g, ' ').trim();
  if (!trimmed) return 'OverHeard Lecture.json';
  return /\.json$/i.test(trimmed) ? trimmed : `${trimmed}.json`;
}

export function replacesLastSave(
  lastSave: SavedDriveFile | null | undefined,
  folderId: string,
  fileName: string,
): boolean {
  if (!lastSave) return false;
  if (lastSave.folderId !== folderId) return false;
  return normalizeJsonFileName(fileName) === normalizeJsonFileName(lastSave.name);
}

export function getDriveAccount(): DriveAccount | null {
  if (cachedAccount) return cachedAccount;
  const raw = readStorage(ACCOUNT_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveAccount>;
    if (parsed && typeof parsed.id === 'string' && typeof parsed.email === 'string') {
      cachedAccount = {
        id: parsed.id,
        email: parsed.email,
        name: typeof parsed.name === 'string' ? parsed.name : parsed.email,
        picture: typeof parsed.picture === 'string' ? parsed.picture : undefined,
      };
      return cachedAccount;
    }
  } catch {
    // Ignore corrupt stored metadata.
  }
  return null;
}

function setDriveAccount(account: DriveAccount | null): void {
  cachedAccount = account;
  writeStorage(ACCOUNT_STORAGE_KEY, account ? JSON.stringify(account) : null);
}

export function getLastDriveFolder(account?: DriveAccount | null): DriveFolderRef | null {
  const raw = readStorage(`${FOLDER_STORAGE_PREFIX}${accountKey(account)}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DriveFolderRef>;
    if (parsed && typeof parsed.id === 'string' && parsed.id && typeof parsed.name === 'string' && parsed.name) {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // Ignore corrupt stored metadata.
  }
  return null;
}

export function setLastDriveFolder(folder: DriveFolderRef, account?: DriveAccount | null): void {
  if (!folder.id || folder.id === AUTO_DEFAULT_FOLDER_ID) return;
  writeStorage(`${FOLDER_STORAGE_PREFIX}${accountKey(account)}`, JSON.stringify(folder));
}

export function getDefaultDriveFolderSelection(account?: DriveAccount | null): DriveFolderRef {
  return getLastDriveFolder(account) ?? DEFAULT_AUTO_FOLDER;
}

export function getRoomDriveSave(saveKey = 'local', account?: DriveAccount | null): SavedDriveFile | null {
  const raw = readStorage(`${LAST_SAVE_STORAGE_PREFIX}${saveKey}_${accountKey(account)}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SavedDriveFile>;
    if (
      parsed &&
      typeof parsed.id === 'string' &&
      typeof parsed.name === 'string' &&
      typeof parsed.folderId === 'string' &&
      typeof parsed.folderName === 'string'
    ) {
      return {
        id: parsed.id,
        name: parsed.name,
        webViewLink: typeof parsed.webViewLink === 'string' ? parsed.webViewLink : undefined,
        folderId: parsed.folderId,
        folderName: parsed.folderName,
      };
    }
  } catch {
    // Ignore corrupt stored metadata.
  }
  return null;
}

export function setRoomDriveSave(saveKey: string, file: SavedDriveFile, account?: DriveAccount | null): void {
  writeStorage(`${LAST_SAVE_STORAGE_PREFIX}${saveKey || 'local'}_${accountKey(account)}`, JSON.stringify(file));
}

export function clearAccessToken(): void {
  tokenState = null;
}

export function resetDriveStateForTests(): void {
  tokenState = null;
  inflightTokenPromise = null;
  cachedAccount = null;
  scriptPromises.clear();
  pickerLoadPromise = null;
}

function loadScript(src: string): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Google Drive scripts can only load in a browser.'));
  }
  const existing = scriptPromises.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromises.delete(src);
      reject(new Error(`Failed to load ${src}. Check your internet connection or content blockers.`));
    };
    document.head.appendChild(script);
  });

  scriptPromises.set(src, promise);
  return promise;
}

async function ensureGisLoaded(): Promise<GoogleAccountsOAuth2> {
  if (!window.google?.accounts?.oauth2) {
    await loadScript(GIS_SRC);
  }
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('Google Identity Services failed to initialize.');
  }
  return oauth2;
}

async function ensurePickerLoaded(): Promise<NonNullable<GoogleGlobal['picker']>> {
  if (window.google?.picker) return window.google.picker;
  if (!window.gapi) {
    await loadScript(GAPI_SRC);
  }
  if (!window.gapi) {
    throw new Error('Google API loader failed to initialize.');
  }
  if (!pickerLoadPromise) {
    pickerLoadPromise = new Promise<void>((resolve, reject) => {
      window.gapi!.load('picker', {
        callback: () => resolve(),
        onerror: () => {
          pickerLoadPromise = null;
          reject(new Error('Failed to load Google Picker.'));
        },
      });
    });
  }
  await pickerLoadPromise;
  if (!window.google?.picker) {
    throw new Error('Google Picker is unavailable.');
  }
  return window.google.picker;
}

export function friendlyGoogleError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err || 'Google Drive request failed.');
  const lower = msg.toLowerCase();
  if (lower.includes('popup_closed') || lower.includes('closed the window')) {
    return 'Google sign-in was cancelled before finishing.';
  }
  if (lower.includes('popup_failed_to_open') || lower.includes('popup blocked')) {
    return 'Your browser blocked the Google sign-in popup. Allow popups for this site and try again.';
  }
  if (lower.includes('access_denied')) {
    return 'Google Drive access was denied. Approve file access in the Google prompt to continue.';
  }
  if (lower.includes('admin_policy_enforced')) {
    return 'Your school or organization administrator has not approved this app for Google Drive yet.';
  }
  if (lower.includes('origin_mismatch') || lower.includes('redirect_uri_mismatch')) {
    return 'This site URL is not authorized in the Google Cloud OAuth settings yet.';
  }
  return msg;
}

async function requestToken(prompt: '' | 'select_account' | 'consent'): Promise<string> {
  if (!isGoogleDriveConfigured()) {
    throw new Error('Google Drive integration is not configured.');
  }
  const { clientId } = getGoogleConfig();
  const oauth2 = await ensureGisLoaded();

  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      prompt: prompt || undefined,
      callback: (response) => {
        if (response.error || !response.access_token) {
          const detail = response.error_description || response.error || 'Google did not return an access token.';
          reject(new Error(friendlyGoogleError(detail)));
          return;
        }
        const expiresInSec = Number.isFinite(response.expires_in) ? Number(response.expires_in) : 3600;
        tokenState = {
          token: response.access_token,
          expiresAt: Date.now() + expiresInSec * 1000,
        };
        resolve(response.access_token);
      },
      error_callback: (err) => {
        const detail = err?.type || err?.message || 'Google sign-in popup could not complete.';
        reject(new Error(friendlyGoogleError(detail)));
      },
    });
    client.requestAccessToken({ prompt });
  });
}

export async function getAccessToken(options?: {
  prompt?: '' | 'select_account' | 'consent';
  forceRefresh?: boolean;
}): Promise<string> {
  const forceRefresh = Boolean(options?.forceRefresh);
  if (!forceRefresh && tokenState && tokenState.expiresAt > Date.now() + 60_000) {
    return tokenState.token;
  }
  if (inflightTokenPromise) {
    return inflightTokenPromise;
  }
  const prompt = options?.prompt ?? '';
  inflightTokenPromise = requestToken(prompt).finally(() => {
    inflightTokenPromise = null;
  });
  return inflightTokenPromise;
}

async function driveFetch(url: string, init: RequestInit = {}, allowInteractiveRetry = true): Promise<Response> {
  const token = await getAccessToken();
  const buildHeaders = (accessToken: string) => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${accessToken}`);
    return headers;
  };

  let res = await fetch(url, { ...init, headers: buildHeaders(token) });
  if (res.status === 401 && allowInteractiveRetry) {
    clearAccessToken();
    const freshToken = await getAccessToken({ forceRefresh: true });
    res = await fetch(url, { ...init, headers: buildHeaders(freshToken) });
  }
  return res;
}

async function parseDriveError(res: Response, fallback: string): Promise<Error> {
  let detail = '';
  try {
    const json = await res.json() as { error?: { message?: string } };
    detail = json?.error?.message || '';
  } catch {
    // Ignore non-JSON error bodies.
  }
  return new Error(friendlyGoogleError(detail || `${fallback} (${res.status})`));
}

export async function fetchDriveAccount(forceRefreshToken = false): Promise<DriveAccount | null> {
  if (forceRefreshToken) {
    clearAccessToken();
  }
  const res = await driveFetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,permissionId,photoLink)',
    {},
    true,
  );
  if (!res.ok) {
    throw await parseDriveError(res, 'Could not read signed-in Google account');
  }
  const data = await res.json() as {
    user?: {
      displayName?: string;
      emailAddress?: string;
      permissionId?: string;
      photoLink?: string;
    };
  };
  const user = data.user;
  if (!user?.emailAddress && !user?.permissionId) return null;
  const account: DriveAccount = {
    id: user.permissionId || user.emailAddress || 'google-user',
    email: user.emailAddress || user.displayName || 'Google Account',
    name: user.displayName || user.emailAddress || 'Google Account',
    picture: user.photoLink,
  };
  setDriveAccount(account);
  return account;
}

export async function ensureDriveSession(options?: { prompt?: '' | 'select_account' | 'consent' }): Promise<DriveAccount | null> {
  await getAccessToken({ prompt: options?.prompt ?? '', forceRefresh: Boolean(options?.prompt) });
  if (cachedAccount && !options?.prompt) {
    return cachedAccount;
  }
  try {
    return await fetchDriveAccount(false);
  } catch {
    return getDriveAccount();
  }
}

export async function switchGoogleAccount(): Promise<DriveAccount | null> {
  clearAccessToken();
  await getAccessToken({ prompt: 'select_account', forceRefresh: true });
  return fetchDriveAccount(false);
}

function escapeDriveQueryValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findDriveFolderByName(
  name: string,
  parentId = 'root',
): Promise<DriveFolderRef | null> {
  const escapedName = escapeDriveQueryValue(name.trim());
  const escapedParent = escapeDriveQueryValue(parentId);
  const query = `name = '${escapedName}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${escapedParent}' in parents`;
  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&spaces=drive&pageSize=1`;
  const res = await driveFetch(url);
  if (!res.ok) {
    throw await parseDriveError(res, 'Could not search Google Drive folders');
  }
  const data = await res.json() as { files?: Array<{ id?: string; name?: string }> };
  const match = data.files?.[0];
  if (!match?.id || !match.name) return null;
  return { id: match.id, name: match.name };
}

export async function createDriveFolder(name: string, parentId = 'root'): Promise<DriveFolderRef> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('Folder name cannot be empty.');
  }
  const res = await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name', {
    method: 'POST',
    headers: { 'Content-Type': JSON_MIME },
    body: JSON.stringify({
      name: trimmed,
      mimeType: FOLDER_MIME,
      parents: [parentId],
    }),
  });
  if (!res.ok) {
    throw await parseDriveError(res, 'Could not create Google Drive folder');
  }
  const data = await res.json() as { id?: string; name?: string };
  if (!data.id) {
    throw new Error('Google Drive did not return an ID for the new folder.');
  }
  return { id: data.id, name: data.name || trimmed };
}

export async function ensureNamedDriveFolder(
  folderName = DEFAULT_DRIVE_FOLDER_NAME,
  account?: DriveAccount | null,
): Promise<DriveFolderRef> {
  const targetName = folderName.trim() || DEFAULT_DRIVE_FOLDER_NAME;
  const existing = await findDriveFolderByName(targetName, 'root');
  const folder = existing ?? await createDriveFolder(targetName, 'root');
  setLastDriveFolder(folder, account);
  return folder;
}

export async function pickDriveFolder(): Promise<DriveFolderRef | null> {
  const token = await getAccessToken();
  const pickerApi = await ensurePickerLoaded();
  const { apiKey, appId } = getGoogleConfig();

  return new Promise<DriveFolderRef | null>((resolve) => {
    const view = new pickerApi.DocsView(pickerApi.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMimeTypes(FOLDER_MIME);

    const picker = new pickerApi.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setTitle('Choose a Google Drive folder')
      .setCallback((data) => {
        if (data.action === pickerApi.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc?.id ? { id: doc.id, name: doc.name || 'Drive folder' } : null);
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

export async function pickDriveJsonFile(): Promise<PickedDriveFile | null> {
  const token = await getAccessToken();
  const pickerApi = await ensurePickerLoaded();
  const { apiKey, appId } = getGoogleConfig();

  return new Promise<PickedDriveFile | null>((resolve) => {
    const view = new pickerApi.DocsView(pickerApi.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes('application/json,text/plain');

    const picker = new pickerApi.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setTitle('Open an OverHeard lecture JSON from Google Drive')
      .setCallback((data) => {
        if (data.action === pickerApi.Action.PICKED) {
          const doc = data.docs?.[0];
          resolve(doc?.id ? { id: doc.id, name: doc.name || 'lecture.json', mimeType: doc.mimeType } : null);
        } else if (data.action === pickerApi.Action.CANCEL) {
          resolve(null);
        }
      })
      .build();

    picker.setVisible(true);
  });
}

export async function downloadDriveJsonFile(fileId: string): Promise<{ name: string; content: string }> {
  const metaRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType`,
  );
  if (!metaRes.ok) {
    throw await parseDriveError(metaRes, 'Could not inspect Google Drive file');
  }
  const meta = await metaRes.json() as { id?: string; name?: string; size?: string };
  const byteSize = meta.size ? Number(meta.size) : 0;
  if (Number.isFinite(byteSize) && byteSize > MAX_ROOM_FILE_BYTES) {
    throw new Error('That Google Drive file is larger than 8 MB and cannot be imported.');
  }

  const contentRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`,
  );
  if (!contentRes.ok) {
    throw await parseDriveError(contentRes, 'Could not download Google Drive file');
  }
  const content = await contentRes.text();
  return {
    name: meta.name || 'lecture.json',
    content,
  };
}

function buildMultipartBody(metadata: Record<string, unknown>, jsonContent: string): {
  boundary: string;
  body: string;
} {
  const boundary = `overheard_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  const body = [
    `--${boundary}`,
    `Content-Type: ${JSON_MIME}; charset=UTF-8`,
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${JSON_MIME}; charset=UTF-8`,
    '',
    jsonContent,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { boundary, body };
}

export async function saveLectureJsonToDrive(
  options: SaveLectureToDriveOptions,
): Promise<SaveLectureToDriveResult> {
  await getAccessToken();
  const account = options.account ?? getDriveAccount();
  const normalizedName = normalizeJsonFileName(options.fileName);

  let targetFolder = options.folder;
  if (targetFolder.id === AUTO_DEFAULT_FOLDER_ID) {
    targetFolder = await ensureNamedDriveFolder(targetFolder.name || DEFAULT_DRIVE_FOLDER_NAME, account);
  } else {
    setLastDriveFolder(targetFolder, account);
  }

  let updatedExisting = false;
  let uploadedFile: { id?: string; name?: string; webViewLink?: string } | null = null;

  if (options.updateFileId) {
    const { boundary, body } = buildMultipartBody({ name: normalizedName }, options.jsonContent);
    const patchRes = await driveFetch(
      `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(options.updateFileId)}?uploadType=multipart&fields=id,name,webViewLink`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (patchRes.ok) {
      uploadedFile = await patchRes.json() as { id?: string; name?: string; webViewLink?: string };
      updatedExisting = true;
    } else if (patchRes.status !== 404) {
      throw await parseDriveError(patchRes, 'Could not update Google Drive file');
    }
  }

  if (!uploadedFile) {
    const { boundary, body } = buildMultipartBody(
      {
        name: normalizedName,
        mimeType: JSON_MIME,
        parents: [targetFolder.id],
      },
      options.jsonContent,
    );
    const createRes = await driveFetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    if (!createRes.ok) {
      throw await parseDriveError(createRes, 'Could not save file to Google Drive');
    }
    uploadedFile = await createRes.json() as { id?: string; name?: string; webViewLink?: string };
  }

  if (!uploadedFile?.id) {
    throw new Error('Google Drive did not return a saved file ID.');
  }

  const saved: SavedDriveFile = {
    id: uploadedFile.id,
    name: uploadedFile.name || normalizedName,
    webViewLink: uploadedFile.webViewLink,
    folderId: targetFolder.id,
    folderName: targetFolder.name,
  };

  setRoomDriveSave(options.saveKey || 'local', saved, account);

  return {
    file: saved,
    folder: targetFolder,
    updatedExisting,
  };
}
