// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withMicAccess } from './micPermission';

const flush = () => new Promise((r) => setTimeout(r, 0));
const setMedia = (getUserMedia?: unknown) =>
  Object.defineProperty(navigator, 'mediaDevices', {
    value: getUserMedia ? { getUserMedia } : undefined,
    configurable: true,
  });
const setSecure = (value: boolean) =>
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });

describe('withMicAccess', () => {
  afterEach(() => {
    setMedia();
    setSecure(true);
  });

  it('requests the mic, closes the test stream, then starts', async () => {
    setSecure(true);
    const stop = vi.fn();
    setMedia(vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }));
    const granted = vi.fn();
    withMicAccess(granted, vi.fn());
    await flush();
    expect(stop).toHaveBeenCalled();
    expect(granted).toHaveBeenCalled();
  });

  it('reports a denial', async () => {
    setSecure(true);
    setMedia(vi.fn().mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' })));
    const granted = vi.fn();
    const blocked = vi.fn();
    withMicAccess(granted, blocked);
    await flush();
    expect(blocked).toHaveBeenCalledWith('denied');
    expect(granted).not.toHaveBeenCalled();
  });

  it('lets recognition try when no mic is found', async () => {
    setSecure(true);
    setMedia(vi.fn().mockRejectedValue(Object.assign(new Error('x'), { name: 'NotFoundError' })));
    const granted = vi.fn();
    withMicAccess(granted, vi.fn());
    await flush();
    expect(granted).toHaveBeenCalled();
  });

  it('blocks plain-http pages and starts synchronously without getUserMedia', () => {
    setSecure(false);
    const blocked = vi.fn();
    withMicAccess(vi.fn(), blocked);
    expect(blocked).toHaveBeenCalledWith('insecure');
    setSecure(true);
    const granted = vi.fn();
    withMicAccess(granted, vi.fn());
    expect(granted).toHaveBeenCalled();
  });
});
