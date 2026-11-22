import { useEffect, useRef, useState } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { PipSubtitlePortal, MAX_PIP_LINES, pipHeightFor } from '../components/PipSubtitlePortal';
import { togglePipLine, visiblePipLines } from '../pipLines';
import type { PipLayout, PipLine } from '../types';
import type { LectureState } from './protocol';
import { loadPipPrefs, savePipPrefs } from './studentPrefs';

export function LecturePip({ state, isDark, fontSize, onAdjustFont, active = true, prefsPrefix = 'overheard.lecturePip' }: {
  state: LectureState; isDark: boolean; fontSize: number; onAdjustFont: (delta: number) => void; active?: boolean; prefsPrefix?: string;
}) {
  const [pip, setPip] = useState<Window | null>(null);
  const windowRef = useRef<Window | null>(null);
  const [notice, setNotice] = useState('');
  const [lines, setLines] = useState<PipLine[]>(() => loadPipPrefs(prefsPrefix).lines);
  const [layout, setLayout] = useState<PipLayout>(() => loadPipPrefs(prefsPrefix).layout);
  const visible = visiblePipLines(lines, state.selectedLangs, MAX_PIP_LINES);
  useEffect(() => savePipPrefs(prefsPrefix, { lines, layout }), [prefsPrefix, lines, layout]);
  useEffect(() => () => { windowRef.current?.close(); }, []);
  useEffect(() => { if (!active) windowRef.current?.close(); }, [active]);
  useEffect(() => { pip?.document.documentElement.classList.toggle('dark', isDark); }, [pip, isDark]);
  const last = state.entries.at(-1);
  const currentSegment = last ? {
    id: last.timestamp, timestamp: String(last.timestamp), english: last.english,
    translations: Object.fromEntries(state.selectedLangs.map(code => [code,
      last.translations[code] || (last.failedLangs[code] ? 'translation unavailable' : '')])),
    status: 'translating' as const,
  } : null;
  const toggle = async () => {
    setNotice('');
    if (pip && !pip.closed) { pip.close(); return; }
    if (!window.documentPictureInPicture) {
      setNotice('Floating captions are unavailable in this browser. Keep this lecture tab open beside your schoolwork.'); return;
    }
    try {
      const initialHeight = layout === 'columns' && visible.length > 1 ? pipHeightFor(1) : pipHeightFor(visible.length);
      const win = await window.documentPictureInPicture.requestWindow({ width: 820, height: initialHeight });
      for (const sheet of Array.from(document.styleSheets)) {
        if (sheet.href) {
          const link = win.document.createElement('link'); link.rel = 'stylesheet'; link.href = sheet.href; win.document.head.appendChild(link);
        } else {
          try { const style = win.document.createElement('style'); style.textContent = Array.from(sheet.cssRules).map(rule => rule.cssText).join('\n'); win.document.head.appendChild(style); }
          catch { /* inaccessible stylesheet */ }
        }
      }
      win.document.title = 'OverHeard — Lecture captions';
      win.document.body.style.margin = '0';
      win.document.documentElement.classList.toggle('dark', isDark);
      win.addEventListener('pagehide', () => { windowRef.current = null; setPip(null); });
      windowRef.current = win; setPip(win);
    } catch { setNotice('Could not open floating captions. Open the room in a full browser tab and try again.'); }
  };
  return <>
    <button type="button" className={`lecture-pip-btn${pip ? ' is-open' : ''}`} onClick={() => void toggle()}
      aria-label={pip ? 'Close pop-out' : 'Pop out lecture'}
      title="Open an always-on-top caption window that floats over slides and other apps">
      <PictureInPicture2 size={14} aria-hidden="true" />
      <span>{pip ? 'Close pop-out' : <>Pop out<span className="oh-wide-only"> lecture</span></>}</span>
    </button>
    {notice && <span role="alert">{notice}</span>}
    <PipSubtitlePortal pipWindow={pip} onClosePip={() => pip?.close()} isDark={isDark}
      isListening={state.isListening} fontSize={fontSize} onAdjustFont={onAdjustFont}
      selectedLangs={state.selectedLangs} visibleLines={visible}
      onToggleLine={line => { const next = togglePipLine(visible, line, state.selectedLangs, MAX_PIP_LINES); if (next) setLines(next); }}
      layout={layout} onToggleLayout={() => setLayout(prev => (prev === 'columns' ? 'stacked' : 'columns'))}
      currentSegment={currentSegment} interimTranscript={state.interim} liveTranslations={state.liveTranslations} />
  </>;
}
