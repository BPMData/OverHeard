import type { DisplayMode, LanguageCode } from '../types';
import { MT_PROVIDER_LABELS, SLOW_TRANSLATION_MS, TRANSLATED_BY, overBy, type MtProviderId, type TranslatorId, type MtPreference } from '../app/settings';
import { prepareOnDeviceTranslators } from '../onDevice';
import { useOnline } from '../app/useOnline';

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
  /** "On this device" translation failed most recently (it never falls back to the server) */
  onDeviceFailing?: boolean;
}

export function TranslatorPicker({
  displayMode, selectedLangs, onDeviceSupported, speechIsLocal, lastTranslateMs,
  lastUsedProvider, availableProviders, effectiveMtPreference, setMtPreference, reportPack,
  onDeviceFailing = false,
}: TranslatorPickerProps) {
  const online = useOnline();
  return (
    <label
      className="oh-btn inline-flex items-center gap-1.5 px-3 py-2 rounded-[2px] text-xs font-semibold border border-[#CBD5E1] dark:border-[#2B3952] bg-[#F8FAFC] dark:bg-[#162033] text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap"
      title={
        lastUsedProvider
          ? `Last caption translated by: ${MT_PROVIDER_LABELS[lastUsedProvider]}`
          : 'Which translator powers live captions. On-device first uses online translation temporarily if the local model is unavailable.'
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
        className="bg-transparent font-semibold outline-none cursor-pointer text-[#0F172A] dark:text-[#F8FAFC] [&>option]:text-[#0F172A]"
      >
        <option value="auto">
          {onDeviceSupported
            ? 'On-device first (online fallback)'
            : availableProviders[0]
              ? `Auto (${MT_PROVIDER_LABELS[availableProviders[0]]})`
              : 'Auto'}
        </option>
        <option value="on-device" disabled={!onDeviceSupported}>
          {MT_PROVIDER_LABELS['on-device']}
          {onDeviceSupported ? ' (speech too)' : ' (needs desktop Chrome 138+)'}
        </option>
        {availableProviders.map((p) => (
          <option key={p} value={p} disabled={!online}>
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
      {effectiveMtPreference === 'on-device' && onDeviceFailing && (
        <span
          role="status"
          className="px-1.5 py-0.5 rounded-[2px] bg-red-600 text-white font-semibold"
          title="Translation on this device failed. On this device never uses online translators, so these lines stay untranslated. Choose a translator with online fallback to use one."
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
