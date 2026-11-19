import { useEffect, useState } from 'react';
import type { MtProviderId } from '../app/settings';

/** The online translators this server offers, in the order it tries them. */
export function useServerConfig() {
  const [availableProviders, setAvailableProviders] = useState<MtProviderId[]>([]);

  useEffect(() => {
    void fetch('/api/config', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((cfg: { providers?: MtProviderId[] }) => {
        setAvailableProviders(Array.isArray(cfg.providers) ? cfg.providers : []);
      })
      .catch(() => {
        // Offline or unreachable: the picker still offers Auto and On this device
      });
  }, []);

  return { availableProviders };
}
