import { useState } from 'react';
import { useTeacherRoom } from './useTeacherRoom';
import type { LectureState } from './protocol';

export function TeacherRoomControls({ state, visible }: { state: LectureState; visible: boolean }) {
  const { room, status, busy, unavailable, create, end } = useTeacherRoom(state);
  const [code, setCode] = useState('');
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
    </> : <form onSubmit={event => { event.preventDefault(); setCopied(false); void create(code); }}>
      <input aria-label="New room code (optional)" placeholder="Room code (optional)" value={code}
        maxLength={40} onChange={event => setCode(event.target.value)} />
      <button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create room'}</button>
    </form>}
    {status && <span aria-live="polite">{status}</span>}
    {!room && <small>Create a room to share this lecture with students. Export JSON to keep a copy.</small>}
  </div>;
}
