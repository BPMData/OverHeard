import { useEffect } from 'react';

type Sentinel = { release: () => Promise<void> };
type WakeLockNavigator = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<Sentinel> };
};

/** Keeps the screen on while `enabled`. Re-acquires after the tab becomes visible again
 *  (browsers drop the lock when hidden). Silently does nothing where unsupported. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    const wl = (navigator as WakeLockNavigator).wakeLock;
    if (!enabled || !wl) return;
    let sentinel: Sentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await wl.request('screen');
        if (cancelled) void s.release().catch(() => {});
        else sentinel = s;
      } catch {
        /* denied (e.g. battery saver) — nothing to do */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
