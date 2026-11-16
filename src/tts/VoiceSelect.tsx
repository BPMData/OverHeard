import type { ConversationLanguage } from '../types';
import {
  BROWSER_VOICE_ID,
  BROWSER_VOICE_LABEL,
  voicesForLanguage,
} from './voices';
import type { PlaybackStatus } from './useSpeechPlayback';

interface VoiceSelectProps {
  lang: ConversationLanguage;
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  onChange: (voiceId: string) => void;
}

export function VoiceSelect({
  lang,
  value,
  ariaLabel,
  disabled = false,
  className,
  onChange,
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
          {voice.label}
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

export function PlaybackToolbar({
  status,
  downloadProgress,
  onTogglePause,
  onStop,
}: PlaybackToolbarProps) {
  if (status === 'idle') return null;
  return (
    <>
      {status === 'downloading' && (
        <span className="tts-status-badge" role="status">
          Downloading voice{typeof downloadProgress === 'number' ? ` (${downloadProgress}%)` : ''}…
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
