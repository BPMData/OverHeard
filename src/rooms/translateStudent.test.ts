// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudentTranslator } from './translateStudent';
import { translateOnDevice } from '../onDevice';
vi.mock('../onDevice', () => ({ translateOnDevice: vi.fn() }));
const local = vi.fn();
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('student automatic translation', () => {
  it('uses available on-device translation and shares simultaneous local requests', async () => {
    local.mockResolvedValue('Bonjour');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const by = vi.fn();
    const translate = createStudentTranslator(local, by);
    expect(await Promise.all([translate('Hello', 'fr'), translate('Hello', 'fr')])).toEqual(['Bonjour', 'Bonjour']);
    expect(by).toHaveBeenCalledWith('on-device');
    expect(local).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('falls back to English → GTX-first server translation when on-device fails', async () => {
    local.mockResolvedValue(null);
    const fetch = vi.fn(async () => new Response(JSON.stringify({ translation: 'Hola' })));
    vi.stubGlobal('fetch', fetch);
    const by = vi.fn();
    expect(await createStudentTranslator(local, by)('Hello', 'es')).toBe('Hola');
    expect(by).toHaveBeenCalledWith('gtx');
    const args = (fetch.mock.calls[0] as unknown[]) as [string, RequestInit];
    expect(JSON.parse(args[1].body as string)).toEqual({ text: 'Hello', lang: 'es', source: 'en', provider: 'gtx', freeOnly: true });
  });
  it('never goes online when the student chose Only on this device', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.mocked(translateOnDevice).mockRejectedValueOnce(new Error('unavailable'));
    const by = vi.fn();
    await expect(createStudentTranslator(local, by, { onDeviceOnly: true })('Hello', 'ps')).rejects.toThrow();
    vi.mocked(translateOnDevice).mockResolvedValueOnce('Hola');
    expect(await createStudentTranslator(local, by, { onDeviceOnly: true })('Hello', 'es')).toBe('Hola');
    expect(by).toHaveBeenCalledWith('on-device');
    expect(fetch).not.toHaveBeenCalled(); expect(local).not.toHaveBeenCalled();
  });
});
