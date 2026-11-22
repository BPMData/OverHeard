// "Chrome language packs" in Settings → Space used on this device.
//
// Chrome's built-in Translator API downloads these packs into Chrome's own profile, shared by
// every site. A web page can ask whether a pack is installed, but Chrome offers no way to see
// its size or delete it, and pages can't open chrome:// pages. So this category lists the
// installed packs and explains how to remove them in Chrome, rather than pretending to.
import { rejectAfter } from '../app/settings';
import { SUPPORTED_LANGUAGES } from '../constants';
import { getOnDeviceAvailability, isOnDeviceTranslationSupported } from '../onDevice';
import type { StorageCategory } from '../storage/registry';

/** Chrome's page with an Uninstall button for each translation pack. */
export const CHROME_PACKS_PAGE = 'chrome://on-device-translation-internals';

/**
 * Chrome doesn't publish pack sizes. This rough range is what we tell teachers before a pack
 * downloads; replace it if Chrome ever reports real numbers.
 */
export const CHROME_PACK_SIZE_HINT = 'tens of MB each';

/** Chrome's availability() can hang (e.g. while its translation service starts); don't wait forever. */
const AVAILABILITY_TIMEOUT_MS = 3000;

type Availability = Awaited<ReturnType<typeof getOnDeviceAvailability>>;

export function createChromePackStorageCategory(
  availability: (code: string, source: string) => Promise<Availability> = getOnDeviceAvailability,
  supported: () => boolean = isOnDeviceTranslationSupported,
): StorageCategory {
  return {
    id: 'chrome-translation-packs',
    title: 'Chrome language packs',
    description:
      'Translation packs Chrome downloaded for “On this device” translation. Chrome keeps them for ' +
      'every website and doesn’t tell websites how big they are.',
    cannotRemoveNote:
      `Chrome doesn’t let websites delete these packs, so OverHeard can’t do it for you. To remove ` +
      `them, copy ${CHROME_PACKS_PAGE} into Chrome’s address bar, press Enter, and click ` +
      `Uninstall next to each language. Chrome downloads a pack again the next time you pick that ` +
      `language with “On this device” translation.`,
    list: async () => {
      if (!supported()) return [];
      const statuses = await Promise.all(
        SUPPORTED_LANGUAGES.map((lang) =>
          rejectAfter(availability(lang.code, 'en'), AVAILABILITY_TIMEOUT_MS).catch(() => 'unavailable' as const),
        ),
      );
      return SUPPORTED_LANGUAGES
        .filter((_, index) => statuses[index] === 'available')
        .map((lang) => ({
          id: lang.code,
          label: `English ↔ ${lang.name}`,
          bytes: null,
          removable: false,
        }));
    },
  };
}
