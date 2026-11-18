import { useCallback, useEffect, useState } from 'react';

export function usePackProgress() {
  // On-device language pack downloads in progress: language code → 0–1, or 'speech' → -1
  // (Chrome reports no progress for speech packs, so that one shows elapsed time only)
  const [packProgress, setPackProgress] = useState<Record<string, number>>({});
  const [packStartedAt, setPackStartedAt] = useState<number | null>(null);
  const [, setPackTick] = useState(0);
  const packDownloading = Object.keys(packProgress).length > 0;

  const reportPack = useCallback((key: string, fraction: number | null) => {
    setPackProgress((prev) => {
      const next = { ...prev };
      if (fraction === null || fraction >= 1) delete next[key];
      else next[key] = fraction;
      return next;
    });
  }, []);

  useEffect(() => {
    if (packDownloading && packStartedAt === null) setPackStartedAt(Date.now());
    if (!packDownloading && packStartedAt !== null) setPackStartedAt(null);
  }, [packDownloading, packStartedAt]);

  // Re-render once a second while downloading so the elapsed time ticks
  useEffect(() => {
    if (!packDownloading) return;
    const id = window.setInterval(() => setPackTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [packDownloading]);

  return { packProgress, packStartedAt, reportPack };
}
