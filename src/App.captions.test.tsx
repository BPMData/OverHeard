// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from './App';
import { isOnDeviceTranslationSupported, translateOnDevice } from './onDevice';

vi.mock('./onDevice', async (importOriginal) => ({
  ...await importOriginal<typeof import('./onDevice')>(),
  isOnDeviceTranslationSupported: vi.fn(),
  isOnDeviceUsable: vi.fn(async () => false),
  prepareOnDeviceTranslators: vi.fn(),
  prepareOnDeviceSpeech: vi.fn(async () => true),
  translateOnDevice: vi.fn(),
}));

type SpeechResult = { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] };

class FakeRecognition {
  static active: FakeRecognition;
  onstart?: () => void;
  onresult?: (event: SpeechResult) => void;
  onend?: () => void;
  start() {
    FakeRecognition.active = this;
    this.onstart?.();
  }
  stop() { this.onend?.(); }
  abort() {}
}

type RequestBody = { text: string; lang: string; source: string };
const mt = vi.fn(async ({ lang, text }: RequestBody) =>
  Response.json({ translation: lang + ': ' + text, provider: 'gtx' }),
);
const phrase = 'The lesson starts at noon';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, '', '/?langs=es');
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    if (url === '/api/config') return Response.json({ providers: ['gtx'] });
    if (url === '/api/mt' && init?.method === 'POST') return mt(JSON.parse(String(init.body)));
    throw new Error('Unexpected request to ' + url);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.mocked(isOnDeviceTranslationSupported).mockReset();
  vi.mocked(translateOnDevice).mockReset();
  mt.mockReset();
});

function click(name: string | RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

async function listen() {
  await act(async () => { render(<App />); });
  click(/Start Listening/);
}

async function say(isFinal: boolean) {
  await act(async () => {
    FakeRecognition.active.onresult!({ resultIndex: 0, results: [{ isFinal, 0: { transcript: phrase } }] });
  });
}

function column(name: string) {
  return within(screen.getByRole('region', { name }));
}

it('fills the English and selected language columns from a final speech result', async () => {
  window.history.replaceState({}, '', '/?langs=es,fr');
  await listen();
  await say(true);
  expect(column('English Captions').getByText(phrase)).toBeTruthy();
  expect(column('Spanish Translation').getByText('es: ' + phrase)).toBeTruthy();
  expect(column('French Translation').getByText('fr: ' + phrase)).toBeTruthy();
  expect(mt.mock.calls.map(([body]) => body)).toEqual(expect.arrayContaining([
    { text: phrase, lang: 'es', source: 'en' }, { text: phrase, lang: 'fr', source: 'en' },
  ]));
  expect(mt).toHaveBeenCalledTimes(2);
});

it('sends live text as free-only and a finished line as an ordinary request', async () => {
  await listen();
  await say(false);
  expect(mt).toHaveBeenLastCalledWith({ text: phrase, lang: 'es', source: 'en', freeOnly: true });
  const finished = phrase + ' sharp';
  await act(async () => {
    FakeRecognition.active.onresult!({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: finished } }] });
  });
  expect(mt).toHaveBeenLastCalledWith({ text: finished, lang: 'es', source: 'en' });
});

it('shows the interim English and translation before the speaker finishes', async () => {
  await listen();
  await say(false);
  expect(column('English Captions').getByText('Speaking live…')).toBeTruthy();
  expect(column('English Captions').getByText(phrase)).toBeTruthy();
  expect(column('Spanish Translation').getByText('es: ' + phrase)).toBeTruthy();
});

it('reuses an in-flight interim request when the same text becomes final', async () => {
  let finish!: (response: Response) => void;
  mt.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await listen();
  await say(false);
  expect(mt).toHaveBeenCalledTimes(1);
  await say(true);
  expect(column('Spanish Translation').getByText('Translating…')).toBeTruthy();
  await act(async () => { finish(Response.json({ translation: 'La clase empieza al mediodía' })); });
  expect(column('Spanish Translation').getByText('La clase empieza al mediodía')).toBeTruthy();
  expect(mt).toHaveBeenCalledTimes(1);
});

it('shows unavailable after HTTP 429 without retrying the request', async () => {
  vi.useFakeTimers();
  mt.mockResolvedValueOnce(new Response(null, { status: 429 }));
  await listen();
  await say(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(column('Spanish Translation').getByText('translation unavailable')).toBeTruthy();
  expect(mt).toHaveBeenCalledTimes(1);
});

it('translates on this device without sending the caption to /api/mt', async () => {
  vi.mocked(isOnDeviceTranslationSupported).mockReturnValue(true);
  vi.mocked(translateOnDevice).mockResolvedValue('La clase empieza al mediodía');
  await act(async () => { render(<App />); });
  const option = screen.getByRole('option', { name: 'On this device (speech too)' }) as HTMLOptionElement;
  fireEvent.change(screen.getByRole('combobox', { name: /Translator/ }), { target: { value: option.value } });
  await act(async () => { click(/Start Listening/); });
  await say(true);
  expect(column('Spanish Translation').getByText('La clase empieza al mediodía')).toBeTruthy();
  expect(mt).not.toHaveBeenCalled();
});

it('never falls back to the server in "On this device" mode, and says so on the page', async () => {
  vi.mocked(isOnDeviceTranslationSupported).mockReturnValue(true);
  vi.mocked(translateOnDevice).mockRejectedValue(new Error('InvalidStateError'));
  await act(async () => { render(<App />); });
  const option = screen.getByRole('option', { name: 'On this device (speech too)' }) as HTMLOptionElement;
  fireEvent.change(screen.getByRole('combobox', { name: /Translator/ }), { target: { value: option.value } });
  await act(async () => { click(/Start Listening/); });
  await say(true);
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(column('Spanish Translation').getByText('translation unavailable')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('On-device translation failing');
  expect(mt).not.toHaveBeenCalled();
});

it('clears the English and translated captions after confirmation', async () => {
  await listen();
  await say(true);
  click('Clear');
  expect(column('Spanish Translation').getByText('es: ' + phrase)).toBeTruthy();
  click('Yes');
  expect(column('English Captions').queryByText(phrase)).toBeNull();
  expect(column('Spanish Translation').getByText('Spanish translation will appear here as each sentence completes.')).toBeTruthy();
});

it('downloads the spoken caption and translation in the version 1 lecture format', async () => {
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const createObjectURL = vi.fn((_blob: Blob) => 'blob:lecture');
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = createObjectURL;
    static revokeObjectURL = vi.fn();
  });
  await listen();
  await say(true);
  click('Export JSON');
  expect(download).toHaveBeenCalledTimes(1);
  const link = download.mock.instances[0] as HTMLAnchorElement;
  expect(link.href).toBe('blob:lecture');
  expect(link.download).toMatch(/^Lecture on .+\.json$/);
  const [[blob]] = createObjectURL.mock.calls;
  expect(blob.type).toBe('application/json');
  const reader = new FileReader();
  const content = new Promise<string>((resolve, reject) => {
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
  });
  reader.readAsText(blob);
  expect(JSON.parse(await content)).toMatchObject({
    format: 'overheard-lecture', version: 1, selectedLangs: ['es'],
    entries: [{ english: phrase, translations: { es: 'es: ' + phrase } }],
  });
});

it('toggles listening with Space and leaves Space available when typing', async () => {
  await act(async () => { render(<App />); });
  fireEvent.keyDown(window, { code: 'Space' });
  expect(screen.getByRole('button', { name: /Stop Listening/ })).toBeTruthy();
  click('Test Input');
  const input = screen.getByPlaceholderText(/Type an English classroom sentence/);
  input.focus();
  expect(fireEvent.keyDown(input, { code: 'Space', key: ' ' })).toBe(true);
  expect(screen.getByRole('button', { name: /Stop Listening/ })).toBeTruthy();
  input.blur();
  fireEvent.keyDown(window, { code: 'Space' });
  expect(screen.getByRole('button', { name: /Start Listening/ })).toBeTruthy();
});
