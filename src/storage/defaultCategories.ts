// Registers the kinds of downloads OverHeard has today: Piper voices, Meta MMS voices, Chrome
// language packs and Bergamot translation models. New kinds register the same way.
import { createBergamotStorageCategory } from '../translation/bergamot/storage';
import { createChromePackStorageCategory } from '../translation/packStorage';
import { piperClient } from '../tts/piperClient';
import { createMmsVoiceStorageCategory, createVoiceStorageCategory } from '../tts/voiceStorage';
import { getStorageCategories, notifyStorageChanged, registerStorageCategory } from './registry';

let registered = false;

export function ensureDefaultStorageCategories(): void {
  if (registered) return;
  registered = true;
  registerStorageCategory(createVoiceStorageCategory(piperClient));
  registerStorageCategory(createMmsVoiceStorageCategory(piperClient));
  registerStorageCategory(createChromePackStorageCategory());
  registerStorageCategory(createBergamotStorageCategory());
  // A voice that finishes downloading (from a preview or read-aloud) changes the tally.
  piperClient.subscribeStatus((status) => {
    if (status.status === 'ready') notifyStorageChanged();
  });
}

export function defaultStorageCategories() {
  ensureDefaultStorageCategories();
  return getStorageCategories();
}
