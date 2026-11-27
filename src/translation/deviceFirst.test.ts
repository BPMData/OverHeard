import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('allows a four-second translation without falling back', async () => {
  vi.stubGlobal('Translator', {
    availability: async () => 'available',
    create: async () => ({ translate: () => new Promise((resolve) => setTimeout(() => resolve('Hola'), 4000)) }),
  });
  const { createDeviceFirstTranslator } = await import('./deviceFirst');
  const local = createDeviceFirstTranslator();
  const result = local.translate('Hello', 'es');
  await vi.advanceTimersByTimeAsync(4000);
  expect(await result).toBe('Hola');
  local.reset();
});

it('gives concurrent captions one download grace period, then resumes on the next ready caption', async () => {
  let status = 'downloading';
  const translate = vi.fn(async (text: string) => 'es:' + text);
  vi.stubGlobal('Translator', { availability: async () => status, create: async () => ({ translate }) });
  const { createDeviceFirstTranslator } = await import('./deviceFirst');
  const local = createDeviceFirstTranslator();
  const first = local.translate('First', 'es');
  await vi.advanceTimersByTimeAsync(8500);
  const second = local.translate('Second', 'es');
  await vi.advanceTimersByTimeAsync(1500);
  expect(await Promise.all([first, second])).toEqual([null, null]);
  expect(await local.translate('Still downloading', 'es')).toBeNull();
  expect(translate).not.toHaveBeenCalled();
  status = 'available';
  expect(await local.translate('Ready', 'es')).toBe('es:Ready');
  local.reset();
});

it('delivers the waiting caption locally when the download completes inside the grace period', async () => {
  let status = 'downloading';
  vi.stubGlobal('Translator', {
    availability: async () => status,
    create: async () => ({ translate: async () => 'Bonjour' }),
  });
  const { createDeviceFirstTranslator } = await import('./deviceFirst');
  const local = createDeviceFirstTranslator();
  const result = local.translate('Hello', 'fr');
  await vi.advanceTimersByTimeAsync(7000);
  status = 'available';
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toBe('Bonjour');
  local.reset();
});

it('keeps fallback per direction until three background sentences succeed, and stops checks on reset', async () => {
  let healthy = false;
  const translate = vi.fn(async (text: string) => {
    if (text === 'Réessaie.') return new Promise<string>(() => {});
    if (text === 'Ouvre le livre.' && !healthy) throw new Error('model stalled');
    return 'translated:' + text;
  });
  vi.stubGlobal('Translator', { availability: async () => 'available', create: async () => ({ translate }) });
  const { createDeviceFirstTranslator } = await import('./deviceFirst');
  const local = createDeviceFirstTranslator();
  const stalled = local.translate('Réessaie.', 'en', 'fr');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await stalled).toBeNull();
  expect(await local.translate('Working direction', 'fr', 'en')).toBe('translated:Working direction');

  await vi.advanceTimersByTimeAsync(29_999);
  expect(await local.translate('Encore.', 'en', 'fr')).toBeNull();
  expect(translate).not.toHaveBeenCalledWith('Bonjour.');
  await vi.advanceTimersByTimeAsync(1);
  expect(translate).toHaveBeenCalledWith('Bonjour.');
  expect(translate).not.toHaveBeenCalledWith('Merci.');
  expect(await local.translate('Toujours en ligne.', 'en', 'fr')).toBeNull();
  healthy = true;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(translate.mock.calls.slice(-3).map(([text]) => text)).toEqual(['Bonjour.', 'Ouvre le livre.', 'Merci.']);
  expect(await local.translate('Nous sommes prêts.', 'en', 'fr')).toBe('translated:Nous sommes prêts.');

  const again = local.translate('Réessaie.', 'en', 'fr');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await again).toBeNull();
  local.reset();
  translate.mockClear();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(translate).not.toHaveBeenCalled();
});

it('cancels a caption waiting for a pack when its language is deselected', async () => {
  vi.stubGlobal('Translator', { availability: async () => 'downloading' });
  const { createDeviceFirstTranslator } = await import('./deviceFirst');
  const local = createDeviceFirstTranslator();
  const result = expect(local.translate('Hello', 'es')).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(100);
  local.reset();
  await vi.advanceTimersByTimeAsync(500);
  await result;
});
