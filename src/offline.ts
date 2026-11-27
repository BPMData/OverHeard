// Offline support. Speech in Auto normally runs on Google's free speech service; when the
// device has no network, it switches to on-device recognition if that pack is installed.
import type { MtPreference } from './app/settings';

/** True only when the browser knows it has no network at all. */
export const isOffline = (): boolean => typeof navigator !== 'undefined' && navigator.onLine === false;

/**
 * How speech should pick where it runs: always on this device, never, or only while offline.
 * 'when-offline' is checked again at every recognizer restart, so a dropped connection
 * moves speech to the device on the next restart, and back once the network returns.
 */
export type SpeechLocality = boolean | 'when-offline';

export const speechLocality = (preference: MtPreference | string): SpeechLocality =>
  preference === 'on-device' ? true : preference === 'auto' ? 'when-offline' : false;

export const wantsLocalSpeech = (locality: SpeechLocality): boolean =>
  locality === true || (locality === 'when-offline' && isOffline());
