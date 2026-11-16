import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTeacherRoom } from './useTeacherRoom';
import type { LectureState } from './protocol';

export function TeacherRoomControls({ state, visible, onRestore }: {
  state: LectureState;
  visible: boolean;
  onRestore?: (restored: Pick<LectureState, 'entries' | 'selectedLangs'>) => void;
}) {
  const { room, status, busy, unavailable, create, rejoin, end } = useTeacherRoom(state, onRestore);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = new URL(window.location.pathname, window.location.origin);
  if (room) link.searchParams.set('room', room.code);
  return <div className="room-controls" hidden={!visible}>
    {room ? <>
      <strong>Room: {room.code}</strong>
      <input aria-label="Student room link" value={link.href} readOnly onFocus={event => event.target.select()} />
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(link.href); setCopied(true); }
        catch { setCopied(false); }
      }}>{copied ? 'Link copied' : 'Copy student link'}</button>
      <button type="button" disabled={busy} onClick={() => void end()}>{unavailable ? 'Dismiss unavailable room' : 'End room'}</button>
    </> : <form onSubmit={event => { event.preventDefault(); setCopied(false); void create(code, pin); }}>
      <input aria-label="Room code (optional for new)" placeholder="Room code (optional)" value={code}
        maxLength={40} onChange={event => setCode(event.target.value)} />
      <span className="room-pin-field">
        <input
          type={showPin ? 'text' : 'password'}
          aria-label="Room PIN"
          placeholder="Room PIN (4+ chars)"
          value={pin}
          maxLength={20}
          autoComplete="off"
          onChange={event => setPin(event.target.value)}
        />
        <button
          type="button"
          className="room-pin-toggle"
          aria-label={showPin ? 'Hide room PIN' : 'Show room PIN'}
          title={showPin ? 'Hide PIN' : 'Show PIN'}
          onClick={() => setShowPin(value => !value)}
        >
          {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      </span>
      <button type="submit" className="conversation-start" disabled={busy}>{busy ? 'Connecting…' : 'Create room'}</button>
      <button type="button" disabled={busy} onClick={() => { setCopied(false); void rejoin(code, pin); }}>Rejoin room</button>
    </form>}
    {status && <span aria-live="polite">{status}</span>}
    {!room && <small>Choose a PIN to create a room, or enter an existing code and PIN to rejoin. Export JSON to keep a copy.</small>}
  </div>;
}
