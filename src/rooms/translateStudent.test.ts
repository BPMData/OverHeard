// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStudentTranslator } from './translateStudent';
const { usable, local } = vi.hoisted(() => ({ usable: vi.fn(), local: vi.fn() }));
vi.mock('../onDevice', () => ({ isOnDeviceUsable: usable, translateOnDevice: local }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('student automatic translation', () => {
  it('uses available on-device translation and shares simultaneous local requests', async () => {
    usable.mockResolvedValue(true); local.mockResolvedValue('Bonjour');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const by = vi.fn();
    const translate = createStudentTranslator(by);
    expect(await Promise.all([translate('Hello', 'fr'), translate('Hello', 'fr')])).toEqual(['Bonjour', 'Bonjour']);
    expect(by).toHaveBeenCalledWith('on-device');
    expect(local).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('falls back to English → GTX-first server translation when on-device fails', async () => {
    usable.mockResolvedValue(true); local.mockRejectedValue(new Error('unavailable'));
    const fetch = vi.fn(async () => new Response(JSON.stringify({ translation: 'Hola' })));
    vi.stubGlobal('fetch', fetch);
    const by = vi.fn();
    expect(await createStudentTranslator(by)('Hello', 'es')).toBe('Hola');
    expect(by).toHaveBeenCalledWith('gtx');
    const args = (fetch.mock.calls[0] as unknown[]) as [string, RequestInit];
    expect(JSON.parse(args[1].body as string)).toEqual({ text: 'Hello', lang: 'es', source: 'en', provider: 'gtx', freeOnly: true });
  });
});
