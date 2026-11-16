import { useRef, useState } from 'react';
import { MAX_ROOM_FILE_BYTES, parseRoomJson, roomJson, type LectureState } from './protocol';

export function LectureFiles({ state, onImport }: {
  state: Pick<LectureState, 'entries' | 'selectedLangs'>;
  onImport: (value: Pick<LectureState, 'entries' | 'selectedLangs'>) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  return <>
    <button type="button" onClick={() => {
      const url = URL.createObjectURL(new Blob([roomJson(state)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url; link.download = `overheard-lecture-${new Date().toISOString().slice(0, 10)}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Export JSON</button>
    <button type="button" onClick={() => input.current?.click()}>Import JSON</button>
    <input ref={input} type="file" accept=".json,application/json" aria-label="Import lecture JSON" hidden
      onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try {
          if (file.size > MAX_ROOM_FILE_BYTES) throw new Error('Room file is too large (8 MB maximum).');
          const imported = parseRoomJson(await file.text());
          if (state.entries.length && !window.confirm('Replace this lecture with the imported file? Export JSON first to keep the current transcript.')) return;
          onImport(imported); setError('');
        } catch (error) { setError(error instanceof Error ? error.message : 'Could not read room file.'); }
      }} />
    {error && <span role="alert">{error}</span>}
  </>;
}
