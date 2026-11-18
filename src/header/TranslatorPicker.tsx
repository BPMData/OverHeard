import type { DisplayMode, LanguageCode } from '../types';
import { MT_PROVIDER_LABELS, SLOW_TRANSLATION_MS, overBy, type MtProviderId, type TranslatorId, type MtPreference } from '../app/settings';
import { prepareOnDeviceTranslators } from '../onDevice';

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
}

export function TranslatorPicker({
  displayMode, selectedLangs, onDeviceSupported, speechIsLocal, lastTranslateMs,
  lastUsedProvider, availableProviders, effectiveMtPreference, setMtPreference, reportPack,
}: TranslatorPickerProps) {
  return (
    <label
      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border border-[#E2E8F0] dark:border-[#1E293B] text-[#0F172A] dark:text-[#F8FAFC] whitespace-nowrap"
      title={
        lastUsedProvider
          ? `Last caption translated by: ${MT_PROVIDER_LABELS[lastUsedProvider]}`
          : 'Which translator powers live captions. Auto uses this device when it can, then the online translators in order.'
      }
    >
      <span className="text-[#64748B] dark:text-[#94A3B8]">Translator</span>
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
          Auto
          {onDeviceSupported
            ? ' (On this device first)'
            : availableProviders[0]
              ? ` (${MT_PROVIDER_LABELS[availableProviders[0]]})`
              : ''}
        </option>
        <option value="on-device" disabled={!onDeviceSupported}>
          {MT_PROVIDER_LABELS['on-device']}
          {onDeviceSupported ? ' (speech too)' : ' (needs desktop Chrome 138+)'}
        </option>
        {availableProviders.map((p) => (
          <option key={p} value={p}>
            {MT_PROVIDER_LABELS[p]}
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
          🎙 {speechIsLocal ? 'local' : 'cloud'}
        </span>
      )}
      {lastUsedProvider &&
        effectiveMtPreference !== 'auto' &&
        lastUsedProvider !== effectiveMtPreference && (
          <span className="text-amber-600 dark:text-amber-400 font-mono">
            ↪ {MT_PROVIDER_LABELS[lastUsedProvider]}
          </span>
        )}
    </label>
  );
}
