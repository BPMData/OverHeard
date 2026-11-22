import type { DisplayMode, LanguageCode } from '../types';
import { MT_PROVIDER_LABELS, SLOW_TRANSLATION_MS, TRANSLATED_BY, overBy, type MtProviderId, type TranslatorId, type MtPreference } from '../app/settings';
import { hasChromeTranslator, prepareOnDeviceTranslators } from '../onDevice';
import { useOnline } from '../app/useOnline';
import { fromEnglish, needOnlineText, useLanguagesNeedingOnline } from '../translation/useLanguagesNeedingOnline';

/** What each translator choice does, shown as its tooltip. */
export function translatorTooltip(
  preference: MtPreference,
  onDeviceSupported: boolean,
  firstProvider: MtProviderId | undefined,
): string {
  switch (preference) {
    case 'auto':
      return onDeviceSupported
        ? 'On-device first: translates on this computer when it can (private, free, works offline). ' +
            'Languages this computer can’t translate, and packs still downloading, use online translation.'
        : 'Auto: translates online' +
            (firstProvider ? `, with ${MT_PROVIDER_LABELS[firstProvider]} first` : '') +
            '. This browser can’t translate on the device.';
    case 'on-device':
      return onDeviceSupported
        ? 'Only on this device: translation never goes online. Languages this computer can’t ' +
            'translate stay untranslated.' +
            (hasChromeTranslator() ? ' In Chrome, speech recognition also runs on this computer.' : '')
        : 'Only on this device: needs a newer browser, such as a recent Chrome.';
    case 'gtx':
      return 'Free (unofficial): always translates online with Google’s free translator. The text is sent to Google.';
    case 'google-cloud':
      return 'Google Cloud: always translates online with Google Cloud Translation, which costs money. The text is sent to Google.';
  }
}

interface TranslatorPickerProps {
  displayMode: DisplayMode;
  selectedLangs: LanguageCode[];
  onDeviceSupported: boolean;
  speechIsLocal: boolean | null;
  lastTranslateMs: number | null;
  lastUsedProvider: TranslatorId | null;
  availableProviders: MtProviderId[];
  effectiveMtPreference: MtPreference;
  setMtPreference: (preference: MtPreference) => void;
  reportPack: (key: string, fraction: number | null) => void;
  /** "Only on this device" translation failed most recently (it never falls back to the server) */
  onDeviceFailing?: boolean;
}

export function TranslatorPicker({
  displayMode, selectedLangs, onDeviceSupported, speechIsLocal, lastTranslateMs,
  lastUsedProvider, availableProviders, effectiveMtPreference, setMtPreference, reportPack,
  onDeviceFailing = false,
}: TranslatorPickerProps) {
  const online = useOnline();
  // Conversation/Lecture shows these notices in its own always-visible row
  const needOnline = useLanguagesNeedingOnline(
    fromEnglish(selectedLangs),
    effectiveMtPreference === 'on-device' && onDeviceSupported && displayMode !== 'conversation',
  );
  const needOnlineNotice = needOnlineText(needOnline, { rooms: true });
  const tip = (preference: MtPreference) =>
    translatorTooltip(preference, onDeviceSupported, availableProviders[0]);
  return (
    <label
      className="oh-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap"
      title={
        tip(effectiveMtPreference) +
        (lastUsedProvider ? `\n\nLast caption translated by: ${TRANSLATED_BY[lastUsedProvider].label}` : '')
      }
    >
      <span className="hidden 2xl:inline text-[#64748B] dark:text-[#94A3B8]">Translator</span>
      <select
        value={effectiveMtPreference}
        onChange={(e) => {
          const next = e.target.value as MtPreference;
          setMtPreference(next);
          // Choosing it is a user gesture, so start downloading language packs now
          if (
            (next === 'on-device' || (next === 'auto' && onDeviceSupported)) &&
            displayMode !== 'conversation'
          ) {
            prepareOnDeviceTranslators(selectedLangs, reportPack);
          }
        }}
        className="oh-fit-select bg-transparent font-semibold outline-none cursor-pointer text-[#0F172A] dark:text-[#F8FAFC] [&>option]:text-[#0F172A]"
      >
        <option value="auto" title={tip('auto')}>
          {onDeviceSupported
            ? 'On-device first'
            : availableProviders[0]
              ? `Auto (${MT_PROVIDER_LABELS[availableProviders[0]]})`
              : 'Auto'}
        </option>
        <option value="on-device" disabled={!onDeviceSupported} title={tip('on-device')}>
          {MT_PROVIDER_LABELS['on-device']}
          {onDeviceSupported ? '' : ' (needs a newer browser)'}
        </option>
        {availableProviders.map((p) => (
          <option key={p} value={p} disabled={!online} title={tip(p)}>
            {MT_PROVIDER_LABELS[p]}
            {online ? '' : ' (needs internet)'}
          </option>
        ))}
      </select>
      {lastTranslateMs !== null && (
        <span
          className={`font-mono ${
            lastTranslateMs > SLOW_TRANSLATION_MS
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-[#64748B] dark:text-[#94A3B8]'
          }`}
          title="Time for the most recent translation, measured in this browser. Every translation is also logged in the browser console."
        >
          {lastTranslateMs} ms{overBy(lastTranslateMs)}
        </span>
      )}
      {displayMode !== 'conversation' && effectiveMtPreference === 'on-device' && speechIsLocal !== null && (
        <span
          className={`font-mono ${
            speechIsLocal
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
          title={
            speechIsLocal
              ? 'Speech recognition is running on this device'
              : 'On-device speech is not available here; using Google’s speech service'
          }
        >
          🎙<span className="hidden xl:inline"> {speechIsLocal ? 'local' : 'cloud'}</span>
        </span>
      )}
      {needOnline.length > 0 && (
        <span
          role="status"
          className="px-1.5 py-0.5 rounded-[2px] bg-red-600 text-white font-semibold"
          title={needOnlineNotice.title}
        >
          {needOnlineNotice.label}
        </span>
      )}
      {needOnline.length === 0 && displayMode !== 'conversation' && effectiveMtPreference === 'on-device' && onDeviceFailing && (
        <span
          role="status"
          className="px-1.5 py-0.5 rounded-[2px] bg-red-600 text-white font-semibold"
          title="Translation on this device failed. Only on this device never uses online translators, so these lines stay untranslated. Choose On-device first or an online translator to use one."
        >
          ⚠ On-device translation failing
        </span>
      )}
      {lastUsedProvider && <TranslatedByBadge provider={lastUsedProvider} compact />}
    </label>
  );
}

const TONE_CLASSES = {
  local: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  free: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  paid: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300',
} as const;

/** Always-visible answer to "which translator just ran?" `compact` shrinks it for the teacher toolbar. */
export function TranslatedByBadge({ provider, compact = false }: { provider: TranslatorId; compact?: boolean }) {
  const info = TRANSLATED_BY[provider];
  if (!compact) {
    return (
      <span className={`px-1.5 py-0.5 rounded-[2px] font-semibold ${TONE_CLASSES[info.tone]}`} title={info.title}>
        Last translation: {info.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-[2px] font-semibold ${TONE_CLASSES[info.tone]}`} title={`Last translation: ${info.label}. ${info.title}`}>
      <span className="xl:hidden w-2 h-2 rounded-full bg-current" aria-hidden="true" />
      <span className="hidden xl:inline"><span className="hidden 2xl:inline">Last translation: </span>{info.label}</span>
    </span>
  );
}
