// Registers the kinds of downloads OverHeard has today. New kinds (MMS voices, Bergamot
// translation models) register themselves the same way from their own modules.
import { createChromePackStorageCategory } from '../translation/packStorage';
import { piperClient } from '../tts/piperClient';
import { createVoiceStorageCategory } from '../tts/voiceStorage';
import { getStorageCategories, notifyStorageChanged, registerStorageCategory } from './registry';

let registered = false;

export function ensureDefaultStorageCategories(): void {
  if (registered) return;
  registered = true;
  registerStorageCategory(createVoiceStorageCategory(piperClient));
  registerStorageCategory(createChromePackStorageCategory());
  // A voice that finishes downloading (from a preview or read-aloud) changes the tally.
  piperClient.subscribeStatus((status) => {
    if (status.status === 'ready') notifyStorageChanged();
  });
}

export function defaultStorageCategories() {
  ensureDefaultStorageCategories();
  return getStorageCategories();
}
