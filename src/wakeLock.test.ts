// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWakeLock } from './wakeLock';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('useWakeLock', () => {
  afterEach(() => {
    delete (navigator as any).wakeLock;
  });

  it('acquires when enabled and releases on disable', async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const request = vi.fn().mockResolvedValue({ release });
    (navigator as any).wakeLock = { request };
    const { rerender } = renderHook(({ on }) => useWakeLock(on), { initialProps: { on: true } });
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    rerender({ on: false });
    expect(release).toHaveBeenCalled();
  });

  it('does nothing when disabled or unsupported', async () => {
    renderHook(() => useWakeLock(true));
    const request = vi.fn();
    (navigator as any).wakeLock = { request };
    renderHook(() => useWakeLock(false));
    await flush();
    expect(request).not.toHaveBeenCalled();
  });
});
