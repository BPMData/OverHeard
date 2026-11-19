import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type Ref } from 'react';
import { Eye, EyeOff, History, Presentation, RefreshCw, X } from 'lucide-react';
import { useTeacherRoom } from './useTeacherRoom';
import {
  checkRoomLiveStatus,
  clearRoomHistory,
  formatRoomAge,
  loadRoomHistory,
  type RoomHistoryEntry,
  type RoomLiveStatus,
} from './roomHistory';
import type { LectureState } from './protocol';
import { displayRoomUrl, loadShortLinkBase, studentRoomUrl } from './roomLink';

const STATUS_RANK: Record<RoomLiveStatus, number> = {
  live: 0,
  ended: 1,
  checking: 2,
  unknown: 3,
  expired: 4,
};

function statusLabel(status: RoomLiveStatus | undefined): string {
  switch (status) {
    case 'live':
      return 'Live';
    case 'ended':
      return 'Ended · rejoinable';
    case 'expired':
      return 'Expired';
    case 'unknown':
      return 'Status unknown';
    default:
      return 'Checking…';
  }
}

export function TeacherRoomControls({ state, visible, id, roomCodeRef, showSetup = true, guideSetup = false, archiveControls, onRestore, onRoomCodeChange }: {
  state: LectureState;
  visible: boolean;
  id?: string;
  roomCodeRef?: Ref<HTMLInputElement>;
  guideSetup?: boolean;
  archiveControls?: ReactNode;
  showSetup?: boolean;
  onRestore?: (restored: Pick<LectureState, 'entries' | 'selectedLangs'>) => void;
  onRoomCodeChange?: (code: string | null) => void;
}) {
  const { room, status, busy, unavailable, canRetry, create, rejoin, end, retryLast, clearRetry } = useTeacherRoom(state, onRestore);
  useEffect(() => {
    onRoomCodeChange?.(room?.code ?? null);
  }, [room?.code, onRoomCodeChange]);
  // Prefill the most recent class code so one posted link works day after day
  const [code, setCode] = useState(() => loadRoomHistory()[0]?.code ?? '');
  const [showJoinCard, setShowJoinCard] = useState(false);
  const [shortBase, setShortBase] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [historyEntries, setHistoryEntries] = useState<RoomHistoryEntry[]>(() => loadRoomHistory());
  const [liveStatuses, setLiveStatuses] = useState<Record<string, RoomLiveStatus>>({});
  const historyRef = useRef<HTMLDivElement>(null);
  const pinInputRef = useRef<HTMLInputElement>(null);
  const checkSeqRef = useRef(0);

  const refreshStatuses = useCallback((entries: RoomHistoryEntry[]) => {
    const seq = ++checkSeqRef.current;
    if (entries.length === 0) {
      setLiveStatuses({});
      return;
    }
    setLiveStatuses(() => {
      const next: Record<string, RoomLiveStatus> = {};
      for (const entry of entries) {
        next[entry.code] = 'checking';
      }
      return next;
    });
    entries.forEach((entry) => {
      void checkRoomLiveStatus(entry.code).then((liveState) => {
        if (seq !== checkSeqRef.current) return;
        setLiveStatuses((prev) => ({ ...prev, [entry.code]: liveState }));
      });
    });
  }, []);

  // Keep local history list in sync whenever a room is created, rejoined, or ended
  useEffect(() => {
    setHistoryEntries(loadRoomHistory());
    if (room) setHistoryOpen(false);
  }, [room]);

  useEffect(() => {
    if (!visible) setHistoryOpen(false);
  }, [visible]);

  useEffect(() => {
    if (!historyOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [historyOpen]);

  const toggleHistory = () => {
    if (historyOpen) {
      setHistoryOpen(false);
      return;
    }
    const entries = loadRoomHistory();
    setHistoryEntries(entries);
    setHistoryOpen(true);
    refreshStatuses(entries);
  };

  const displayedEntries = useMemo(() => {
    const sorted = [...historyEntries].sort((a, b) => {
      const rankA = STATUS_RANK[liveStatuses[a.code] ?? 'checking'];
      const rankB = STATUS_RANK[liveStatuses[b.code] ?? 'checking'];
      if (rankA !== rankB) return rankA - rankB;
      return b.lastUsedAt - a.lastUsedAt;
    });
    if (!liveOnly) return sorted;
    return sorted.filter((entry) => {
      const st = liveStatuses[entry.code] ?? 'checking';
      return st === 'live' || st === 'checking';
    });
  }, [historyEntries, liveOnly, liveStatuses]);

  useEffect(() => {
    if (!room || !visible) setShowJoinCard(false);
  }, [room, visible]);
  const hasRoom = Boolean(room);
  useEffect(() => {
    if (!hasRoom) return;
    let current = true;
    void loadShortLinkBase().then(base => { if (current) setShortBase(base); });
    return () => { current = false; };
  }, [hasRoom]);
  useEffect(() => {
    if (!showJoinCard) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setShowJoinCard(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showJoinCard]);

  const link = room ? studentRoomUrl(room.code, shortBase) : '';
  return <div id={id} className="room-controls" hidden={!visible || (!room && !showSetup)}>
    {room ? <>
      <strong>Room: {room.code}</strong>
      <input aria-label="Student room link" value={link} readOnly onFocus={event => event.target.select()} />
      <button type="button" onClick={async () => {
        try { await navigator.clipboard.writeText(link); setCopied(true); }
        catch { setCopied(false); }
      }}>{copied ? 'Link copied' : 'Copy student link'}</button>
      <button type="button" className="room-show-join inline-flex items-center gap-1.5" onClick={() => setShowJoinCard(true)}>
        <Presentation size={14} aria-hidden="true" />
        <span>Show join code</span>
      </button>
      {showJoinCard && (
        <div className="room-join-card" role="dialog" aria-modal="true" aria-label="Join this room"
          onClick={() => setShowJoinCard(false)}>
          <button type="button" className="room-join-card-close" aria-label="Close join info"
            onClick={() => setShowJoinCard(false)}><X size={28} /></button>
          <p className="room-join-card-lead">Follow the live captions in your language</p>
          <p className="room-join-card-url">
            {/* Break only after the host, never inside the room code */}
            <span>{displayRoomUrl(room.code, shortBase).slice(0, -room.code.length)}</span><wbr />
            <span className="room-join-card-code">{room.code}</span>
          </p>
          {!shortBase && (
            <p className="room-join-card-alt">
              or open <strong>{window.location.host}</strong> and enter code <strong>{room.code}</strong>
            </p>
          )}
        </div>
      )}
      <button type="button" disabled={busy} onClick={() => void end()}>{unavailable ? 'Dismiss unavailable room' : 'End room'}</button>
    </> : <form autoComplete="off" onSubmit={event => { event.preventDefault(); setCopied(false); void create(code, pin); }}>
      <input ref={roomCodeRef} aria-label="Room code (optional for new)" placeholder="Room code (optional)" value={code}
        autoComplete="off" maxLength={40} onChange={event => { setCode(event.target.value); clearRetry(); }} />
      <span className="room-pin-field">
        <input
          ref={pinInputRef}
          type="text"
          className={showPin ? undefined : 'room-pin-masked'}
          aria-label="Room PIN"
          placeholder="Room PIN (4+ chars)"
          value={pin}
          maxLength={20}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-lpignore="true"
          data-1p-ignore="true"
          onChange={event => { setPin(event.target.value); clearRetry(); }}
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
      <div className="room-history-wrap" ref={historyRef}>
        <button
          type="button"
          className={`room-history-btn${historyOpen ? ' is-open' : ''}`}
          aria-expanded={historyOpen}
          aria-haspopup="true"
          onClick={toggleHistory}
        >
          <History size={14} />
          <span>History</span>
        </button>
        {historyOpen && (
          <div className="room-history-menu" role="region" aria-label="Recent room history">
            <div className="room-history-header">
              <strong>Recent rooms</strong>
              <div className="room-history-actions">
                <label className="room-history-filter">
                  <input
                    type="checkbox"
                    checked={liveOnly}
                    onChange={(event) => setLiveOnly(event.target.checked)}
                  />
                  <span>Live only</span>
                </label>
                {historyEntries.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="room-history-icon-btn"
                      aria-label="Refresh room status"
                      title="Refresh status"
                      onClick={() => refreshStatuses(historyEntries)}
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      type="button"
                      className="room-history-clear"
                      onClick={() => {
                        clearRoomHistory();
                        setHistoryEntries([]);
                        setLiveStatuses({});
                      }}
                    >
                      Clear
                    </button>
                  </>
                )}
              </div>
            </div>
            <p className="room-history-hint">
              Click a room name, enter your PIN, and click Rejoin room. PINs are never saved.
            </p>
            {historyEntries.length === 0 ? (
              <div className="room-history-empty">No rooms created on this browser yet.</div>
            ) : displayedEntries.length === 0 ? (
              <div className="room-history-empty">
                No live rooms right now. Uncheck Live only to see ended or expired rooms.
              </div>
            ) : (
              <ul className="room-history-list">
                {displayedEntries.map((entry) => {
                  const st = liveStatuses[entry.code] ?? 'checking';
                  return (
                    <li key={entry.code}>
                      <button
                        type="button"
                        className={`room-history-item is-${st}`}
                        onClick={() => {
                          setCode(entry.code);
                          setCopied(false);
                          clearRetry();
                          setHistoryOpen(false);
                          pinInputRef.current?.focus();
                        }}
                      >
                        <span className="room-history-dot" aria-hidden="true" />
                        <span className="room-history-code">{entry.code}</span>
                        <span className="room-history-age">{formatRoomAge(entry.lastUsedAt)}</span>
                        <span className="room-history-status">{statusLabel(st)}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </form>}
    {archiveControls}
    {(status || canRetry) && (
      <span className="room-status" aria-live="polite">
        <span>{status}</span>
        {canRetry && !busy && (
          <button type="button" className="room-retry-btn" onClick={() => void retryLast()}>
            Retry
          </button>
        )}
      </span>
    )}
    {!room && <small>{guideSetup
      ? 'Create or rejoin a room, then click Start lecture. You can share the join code before you start.'
      : 'Use the same room code every day (e.g. murphy-p3) and post its link once; students who open it early wait until you start. Create room reopens a code that is still active when the PIN matches. Export JSON to keep a copy.'}</small>}
  </div>;
}
