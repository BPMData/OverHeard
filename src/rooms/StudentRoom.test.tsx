// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getOnDeviceAvailability } from '../onDevice';
import { StudentRoom } from './StudentRoom';
import { emptyLecture } from './protocol';
import type { RoomSnapshot } from './protocol';
import type { LectureEntry } from '../conversation/lectureState';

const { translate, prepare } = vi.hoisted(() => ({ translate: vi.fn(), prepare: vi.fn() }));
vi.mock('./translateStudent', () => ({ createStudentTranslator: () => translate }));
vi.mock('../onDevice', () => ({ prepareOnDeviceTranslators: prepare, getOnDeviceAvailability: vi.fn(async () => 'unavailable') }));
class FakeEvents extends EventTarget {
  static instances: FakeEvents[] = [];
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { super(); FakeEvents.instances.push(this); }
  emit(name: string, data: unknown) { this.dispatchEvent(new MessageEvent(name, { data: JSON.stringify(data) })); }
}
const entry: LectureEntry = { id: 'one', timestamp: 100, english: 'Welcome to science', translations: { es: 'Bienvenidos a ciencias' }, failedLangs: {} };
const snapshot = (): RoomSnapshot => ({ ...emptyLecture(), entries: [entry], selectedLangs: ['es'], revision: 1, teacherOnline: true, ended: false, isListening: true });
beforeEach(() => {
  localStorage.clear();
  FakeEvents.instances = []; translate.mockReset(); prepare.mockReset();
  translate.mockImplementation(async (text: string, language: string) => `${language}:${text}`);
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('SpeechRecognition', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const emit = async (data = snapshot()) => { await act(async () => FakeEvents.instances[0].emit('snapshot', data)); };

describe('student lecture view', () => {
  it('defaults to Spanish with the Claude voice when no preferences are saved', async () => {
    render(<StudentRoom code="macbookairtest" />);
    await emit();
    expect((screen.getByLabelText('My language') as HTMLSelectElement).value).toBe('es');
    expect((screen.getByLabelText('Voice') as HTMLSelectElement).value).toBe('es_MX-claude-high');
    expect(screen.getByText('Bienvenidos a ciencias')).toBeTruthy();
  });

  it('offers a download gesture for the default language on a direct room link', async () => {
    vi.mocked(getOnDeviceAvailability).mockResolvedValueOnce('downloadable');
    render(<StudentRoom code="science-101" />);
    await emit({ ...snapshot(), selectedLangs: [], entries: [] });
    fireEvent.click(await screen.findByRole('button', { name: 'Download language for this device' }));
    expect(prepare).toHaveBeenCalledWith(['es'], expect.any(Function));
  });

  it('is read-only and reuses teacher translations without starting a microphone', async () => {
    render(<StudentRoom code="science-101" />); await emit();
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    expect(screen.getByText('Bienvenidos a ciencias')).toBeTruthy();
    expect(translate).not.toHaveBeenCalled();
    expect(window.SpeechRecognition).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /start|pause|clear|import|create room/i })).toBeNull();
    expect(screen.queryByLabelText('Lecture line text')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
  });
  it('waits for pending teacher translations, then translates only an additional language', async () => {
    render(<StudentRoom code="science-101" />);
    await emit({ ...snapshot(), entries: [{ ...entry, translations: {} }] });
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    expect(translate).not.toHaveBeenCalled();
    await act(async () => FakeEvents.instances[0].emit('patch', { ...snapshot(), removedIds: [], revision: 2 }));
    expect(screen.getByText('Bienvenidos a ciencias')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'fr' } });
    await waitFor(() => expect(screen.getByText('fr:Welcome to science')).toBeTruthy());
    expect(translate).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledWith(['fr']);
    // A later teacher-provided result takes precedence over the student's cached one.
    await emit({ ...snapshot(), entries: [{ ...entry, translations: { ...entry.translations, fr: 'Bienvenue en sciences' } } as typeof entry] });
    expect(screen.getByText('Bienvenue en sciences')).toBeTruthy();
  });
  it('does not resurrect removed rows when a local translation finishes after a clear', async () => {
    let finish!: (value: string) => void;
    translate.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<StudentRoom code="science-101" />); await emit();
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'fr' } });
    await emit({ ...snapshot(), entries: [], revision: 2 });
    await act(async () => finish('Old translation'));
    expect(screen.queryByText('Old translation')).toBeNull();
    expect(screen.queryByText('Welcome to science')).toBeNull();
  });
  it('shows a browser fallback and renders shared captions in a read-only pop-out', async () => {
    render(<StudentRoom code="science-101" />); await emit();
    fireEvent.click(screen.getByRole('button', { name: 'Pop out lecture' }));
    expect(screen.getByRole('alert').textContent).toContain('unavailable in this browser');
    const pipDocument = document.implementation.createHTMLDocument('PiP');
    const win = { document: pipDocument, addEventListener: vi.fn(), close: vi.fn(), closed: false };
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async () => win) });
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pop out lecture' }));
    await waitFor(() => expect(within(pipDocument.body).getByText('Bienvenidos a ciencias')).toBeTruthy());
    expect([...pipDocument.querySelectorAll('button')].some(button => /mic|listening/i.test(button.textContent || ''))).toBe(false);
    await emit({ ...snapshot(), interim: 'A new sentence', liveTranslations: { es: 'Una nueva frase' } });
    expect(within(pipDocument.body).getByText('Una nueva frase')).toBeTruthy();
    cleanup(); expect(win.close).toHaveBeenCalled();
  });

  it('defaults to dark mode, toggles with Sun/Moon button, and restores saved student + pop-out preferences across rooms', async () => {
    const pipDocument = document.implementation.createHTMLDocument('PiP');
    Object.defineProperty(pipDocument, 'defaultView', { value: window, configurable: true });
    const win = { document: pipDocument, addEventListener: vi.fn(), close: vi.fn(), closed: false };
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async () => win) });

    render(<StudentRoom code="room-one" />);
    await emit();
    const main = screen.getByRole('main');
    expect(main.className).toContain('conversation-dark');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(main.className).not.toContain('conversation-dark');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pop out lecture' }));
    await waitFor(() =>
      expect(within(pipDocument.body).getByRole('button', { name: /Side by side columns/i })).toBeTruthy(),
    );
    fireEvent.click(within(pipDocument.body).getByRole('button', { name: /Side by side columns/i }));
    expect(pipDocument.body.querySelector('[data-layout="columns"]')).toBeTruthy();

    // Opening another room on the same device restores light mode, Spanish, font size, and side-by-side pop-out
    cleanup();
    const pipDoc2 = document.implementation.createHTMLDocument('PiP2');
    Object.defineProperty(pipDoc2, 'defaultView', { value: window, configurable: true });
    const win2 = { document: pipDoc2, addEventListener: vi.fn(), close: vi.fn(), closed: false };
    vi.stubGlobal('documentPictureInPicture', { requestWindow: vi.fn(async () => win2) });

    render(<StudentRoom code="room-two" />);
    await emit();
    expect(screen.getByRole('main').className).not.toContain('conversation-dark');
    expect((screen.getByLabelText('My language') as HTMLSelectElement).value).toBe('es');
    fireEvent.click(screen.getByRole('button', { name: 'Pop out lecture' }));
    await waitFor(() => expect(pipDoc2.body.querySelector('[data-layout="columns"]')).toBeTruthy());
  });

  it('reads sequentially from a clicked cell, stops at backlog end, supports pause/resume/stop, and handles live Read aloud', async () => {
    class FakeUtterance {
      lang = '';
      voice: { lang: string } | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const spokenQueue: FakeUtterance[] = [];
    const speak = vi.fn((u: FakeUtterance) => spokenQueue.push(u));
    const pause = vi.fn();
    const resume = vi.fn();
    const cancel = vi.fn(() => {
      spokenQueue.length = 0;
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
    vi.stubGlobal('speechSynthesis', {
      speak,
      pause,
      resume,
      cancel,
      getVoices: () => [{ lang: 'es-MX' }, { lang: 'pt-BR' }],
      get speaking() {
        return spokenQueue.length > 0;
      },
      get pending() {
        return spokenQueue.length > 1;
      },
    });

    const entries: LectureEntry[] = [
      { id: 'e1', timestamp: 1, english: 'First line', translations: { es: 'Primera línea' }, failedLangs: {} },
      { id: 'e2', timestamp: 2, english: 'Second line', translations: { es: 'Segunda línea' }, failedLangs: {} },
      { id: 'e3', timestamp: 3, english: 'Third line', translations: { es: 'Tercera línea' }, failedLangs: {} },
    ];
    render(<StudentRoom code="science-101" />);
    await emit({ ...snapshot(), entries, selectedLangs: ['es'] });

    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    fireEvent.change(screen.getByLabelText('Voice'), { target: { value: 'es_MX-ald-medium' } });
    expect(JSON.parse(localStorage.getItem('overheard.voices')!).es).toBe('es_MX-ald-medium');

    // Click play on row #2 in Spanish: reads #2 then #3 and stops at end of backlog
    fireEvent.click(screen.getByRole('button', { name: 'Read from #2 in Spanish' }));
    expect(speak).toHaveBeenCalledTimes(1);
    expect(spokenQueue[0].text).toBe('Segunda línea');

    // Pause and Resume
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(resume).toHaveBeenCalledTimes(1);

    // Finish #2 -> advances to #3
    await act(async () => {
      spokenQueue.shift()?.onend?.();
    });
    expect(speak).toHaveBeenCalledTimes(2);
    expect(spokenQueue[0].text).toBe('Tercera línea');

    // Finish #3 -> stops cleanly because Read aloud is off
    await act(async () => {
      spokenQueue.shift()?.onend?.();
    });
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();

    // New entry arrives while Read aloud is off: does not auto-speak
    const entry4: LectureEntry = {
      id: 'e4',
      timestamp: 4,
      english: 'Fourth line',
      translations: { es: 'Cuarta línea' },
      failedLangs: {},
    };
    await emit({ ...snapshot(), entries: [...entries, entry4], selectedLangs: ['es'], revision: 2 });
    expect(speak).toHaveBeenCalledTimes(2);

    // Enable live Read aloud: does not replay #1-#4, only speaks newly arriving #5
    fireEvent.click(screen.getByRole('checkbox', { name: 'Read aloud' }));
    expect(speak).toHaveBeenCalledTimes(2);

    const entry5: LectureEntry = {
      id: 'e5',
      timestamp: 5,
      english: 'Fifth line',
      translations: { es: 'Quinta línea' },
      failedLangs: {},
    };
    await emit({ ...snapshot(), entries: [...entries, entry4, entry5], selectedLangs: ['es'], revision: 3 });
    expect(speak).toHaveBeenCalledTimes(3);
    expect(spokenQueue[0].text).toBe('Quinta línea');

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancel).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it('lets students configure voices via the Voice settings modal and export lecture JSON with a legible room filename', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = vi.fn(() => 'blob:student-export');
    URL.revokeObjectURL = vi.fn();

    render(<StudentRoom code="piper-test-001" />);
    await emit();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Default Spanish voice'), {
      target: { value: 'es_MX-ald-medium' },
    });
    expect(JSON.parse(localStorage.getItem('overheard.voices')!).es).toBe('es_MX-ald-medium');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    // Selecting Spanish in My language reflects the saved default voice from Voice settings
    fireEvent.change(screen.getByLabelText('My language'), { target: { value: 'es' } });
    expect((screen.getByLabelText('Voice') as HTMLSelectElement).value).toBe('es_MX-ald-medium');

    // Exporting JSON sets a legible filename containing the room name
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const anchor = clickSpy.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toMatch(/^Lecture for piper-test-001 on .+\.json$/);

    const homeLink = screen.getByRole('link', { name: /OverHeard/i }) as HTMLAnchorElement;
    expect(homeLink.getAttribute('href')).toBe('/');

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});

describe('student waiting for the teacher', () => {
  it('waits on a link opened before class and connects once the teacher starts', async () => {
    vi.useFakeTimers();
    try {
      let open = false;
      const fetchMock = vi.fn(async () => ({ ok: open, status: open ? 200 : 404, json: async () => ({}) }));
      vi.stubGlobal('fetch', fetchMock);
      render(<StudentRoom code="murphy-p3" />);
      await act(async () => { FakeEvents.instances[0].onerror?.(); });
      expect(screen.getByText(/Waiting for your teacher to start room murphy-p3/)).toBeTruthy();
      expect(FakeEvents.instances[0].close).toHaveBeenCalled();

      // Still closed on the next check: keeps waiting without opening another stream
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(FakeEvents.instances).toHaveLength(1);

      open = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
      expect(FakeEvents.instances).toHaveLength(2);
      await act(async () => FakeEvents.instances[1].emit('snapshot', snapshot()));
      expect(screen.getByText('Bienvenidos a ciencias')).toBeTruthy();
      expect(screen.queryByText(/Waiting for your teacher/)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
