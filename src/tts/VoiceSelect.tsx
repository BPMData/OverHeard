import type { ConversationLanguage } from '../types';
import { BROWSER_VOICE_ID, BROWSER_VOICE_LABEL, voiceDownloadLabel, voicesForLanguage } from './voices';
import type { PlaybackStatus } from './useSpeechPlayback';

interface VoiceSelectProps {
  lang: ConversationLanguage;
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (voiceId: string) => void;
  /** Model ids already saved on this device; those options say "saved" instead of a size */
  savedModelIds?: ReadonlySet<string> | null;
}

/** Option text with the download size, so people know what a voice takes up before it downloads. */
export function voiceOptionLabel(
  voice: { id: string; label: string; modelId: string },
  savedModelIds?: ReadonlySet<string> | null
): string {
  if (savedModelIds?.has(voice.modelId)) return `${voice.label} — saved`;
  const size = voiceDownloadLabel(voice.id);
  return size ? `${voice.label} — ${size}` : voice.label;
}

export function VoiceSelect({
  lang,
  value,
  ariaLabel,
  disabled = false,
  className,
  onChange,
  savedModelIds,
}: VoiceSelectProps) {
  const piperVoices = voicesForLanguage(lang);
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      className={className}
      onChange={(event) => onChange(event.target.value)}
    >
      {piperVoices.map((voice) => (
        <option key={voice.id} value={voice.id}>
          {voiceOptionLabel(voice, savedModelIds)}
        </option>
      ))}
      <option value={BROWSER_VOICE_ID}>{BROWSER_VOICE_LABEL}</option>
    </select>
  );
}

interface PlaybackToolbarProps {
  status: PlaybackStatus;
  downloadProgress: number | null;
  onTogglePause: () => void;
  onStop: () => void;
}

export function PlaybackToolbar({ status, downloadProgress, onTogglePause, onStop }: PlaybackToolbarProps) {
  if (status === 'idle') return null;
  return (
    <>
      {status === 'downloading' && (
        <span className="tts-status-badge" role="status">
          {typeof downloadProgress === 'number' ? `Downloading voice (${downloadProgress}%)…` : 'Loading voice…'}
        </span>
      )}
      {status !== 'downloading' && (
        <button type="button" onClick={onTogglePause}>
          {status === 'paused' ? 'Resume' : 'Pause'}
        </button>
      )}
      <button type="button" onClick={onStop}>
        Stop
      </button>
    </>
  );
}
