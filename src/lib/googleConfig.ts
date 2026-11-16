export interface GoogleConfig {
  clientId: string;
  apiKey: string;
  appId: string;
}

declare global {
  interface Window {
    __OVERHEARD_GOOGLE_CONFIG__?: Partial<GoogleConfig>;
  }
}

/**
 * Default OAuth/Picker config shared with Cloud project 606573080592 so it works
 * as soon as OverHeard's origins are added to the existing OAuth Client ID and
 * Picker API key. Override via VITE_GOOGLE_* env vars to point OverHeard at its
 * own dedicated Google Cloud project/branding without code changes.
 *
 * All three values are intentionally public browser identifiers (never client secrets).
 */
const DEFAULT_GOOGLE_CONFIG: GoogleConfig = {
  clientId: '606573080592-qtfiemip0l022q25monfj5hbhl6kamap.apps.googleusercontent.com',
  apiKey: 'AIzaSyDj4vCWgF3I8dQm7yh1u2ExeZOVjHwpGCo',
  appId: '606573080592',
};

function readEnv(key: 'VITE_GOOGLE_CLIENT_ID' | 'VITE_GOOGLE_API_KEY' | 'VITE_GOOGLE_APP_ID'): string {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return env?.[key]?.trim() ?? '';
}

export function getGoogleConfig(): GoogleConfig {
  const override = typeof window !== 'undefined' ? window.__OVERHEARD_GOOGLE_CONFIG__ : undefined;
  return {
    clientId: override?.clientId?.trim() || readEnv('VITE_GOOGLE_CLIENT_ID') || DEFAULT_GOOGLE_CONFIG.clientId,
    apiKey: override?.apiKey?.trim() || readEnv('VITE_GOOGLE_API_KEY') || DEFAULT_GOOGLE_CONFIG.apiKey,
    appId: override?.appId?.trim() || readEnv('VITE_GOOGLE_APP_ID') || DEFAULT_GOOGLE_CONFIG.appId,
  };
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(getGoogleConfig().clientId);
}

export function isGoogleDriveConfigured(): boolean {
  const { clientId, apiKey, appId } = getGoogleConfig();
  return Boolean(clientId && apiKey && appId);
}
