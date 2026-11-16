// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudentRoom } from './StudentRoom';
import { emptyLecture } from './protocol';
import type { RoomSnapshot } from './protocol';
import type { LectureEntry } from '../conversation/lectureState';

const { translate, prepare } = vi.hoisted(() => ({ translate: vi.fn(), prepare: vi.fn() }));
vi.mock('./translateStudent', () => ({ createStudentTranslator: () => translate }));
vi.mock('../onDevice', () => ({ prepareOnDeviceTranslators: prepare }));
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
  FakeEvents.instances = []; translate.mockReset(); prepare.mockReset();
  translate.mockImplementation(async (text: string, language: string) => `${language}:${text}`);
  vi.stubGlobal('EventSource', FakeEvents);
  vi.stubGlobal('SpeechRecognition', vi.fn());
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const emit = async (data = snapshot()) => { await act(async () => FakeEvents.instances[0].emit('snapshot', data)); };

describe('student lecture view', () => {
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
});
