import { useRef, useState } from 'react';
import { MAX_ROOM_FILE_BYTES, parseRoomJson, roomJson, type LectureState } from './protocol';

function ordinalDay(day: number): string {
  const mod100 = day % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function formatLectureFilename(roomCode?: string | null, date: Date = new Date()): string {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  const day = ordinalDay(date.getDate());
  const year = date.getFullYear();
  const cleanRoom = roomCode?.trim().replace(/[\\/:*?"<>|]+/g, '-');
  const prefix = cleanRoom ? `Lecture for ${cleanRoom}` : 'Lecture';
  return `${prefix} on ${weekday}, ${month} ${day}, ${year}.json`;
}

export function ExportLectureButton({
  state,
  roomCode,
  className,
}: {
  state: Pick<LectureState, 'entries' | 'selectedLangs'>;
  roomCode?: string | null;
  className?: string;
}) {
  const [error, setError] = useState('');
  return (
    <>
      <button
        type="button"
        className={className}
        disabled={state.entries.length === 0}
        onClick={() => {
          let json: string;
          try {
            json = roomJson(state);
            setError('');
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not export the lecture.');
            return;
          }
          const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
          const link = document.createElement('a');
          link.href = url;
          link.download = formatLectureFilename(roomCode);
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        Export JSON
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}

export function LectureFiles({
  state,
  onImport,
  roomCode,
  itemClassName,
}: {
  state: Pick<LectureState, 'entries' | 'selectedLangs'>;
  onImport: (value: Pick<LectureState, 'entries' | 'selectedLangs'>) => void;
  roomCode?: string | null;
  itemClassName?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return (
    <>
      <ExportLectureButton state={state} roomCode={roomCode} className={itemClassName} />
      <button type="button" className={itemClassName} onClick={() => input.current?.click()}>
        Import JSON
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        aria-label="Import lecture JSON"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          try {
            if (file.size > MAX_ROOM_FILE_BYTES) throw new Error('Room file is too large (8 MB maximum).');
            const imported = parseRoomJson(await file.text());
            if (
              state.entries.length &&
              !window.confirm(
                'Replace this lecture with the imported file? Export JSON first to keep the current transcript.'
              )
            )
              return;
            onImport(imported);
            setError('');
          } catch (error) {
            setError(error instanceof Error ? error.message : 'Could not read room file.');
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
    </>
  );
}
