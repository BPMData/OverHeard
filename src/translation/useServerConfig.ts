import { useCallback, useEffect, useRef, useState } from 'react';
import { GEMINI_REFINE_STORAGE_KEY, type MtProviderId } from '../app/settings';
import type { ServerRefineStatus } from '../components/VoiceSettingsModal';

export function useServerConfig(isVoiceSettingsOpen: boolean) {
  const [availableProviders, setAvailableProviders] = useState<MtProviderId[]>([]);
  const refineEnabledRef = useRef<boolean>(false);
  const [serverRefineAvailable, setServerRefineAvailable] = useState<boolean>(false);
  const [serverRefineStatus, setServerRefineStatus] = useState<ServerRefineStatus>('loading');
  const [geminiRefineEnabled, setGeminiRefineEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(GEMINI_REFINE_STORAGE_KEY);
      if (saved === 'false') return false;
      if (saved === 'true') return true;
    } catch {
      // Storage unavailable
    }
    return true;
  });
  const geminiRefineEnabledRef = useRef<boolean>(geminiRefineEnabled);
  useEffect(() => {
    geminiRefineEnabledRef.current = geminiRefineEnabled;
    try {
      localStorage.setItem(GEMINI_REFINE_STORAGE_KEY, String(geminiRefineEnabled));
    } catch {
      // Ignore storage failures; choice applies for this session
    }
  }, [geminiRefineEnabled]);

  const refreshServerConfig = useCallback(() => {
    return fetch('/api/config', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((cfg: { refine?: boolean; providers?: MtProviderId[] }) => {
        const avail = Boolean(cfg.refine);
        refineEnabledRef.current = avail;
        setServerRefineAvailable(avail);
        setServerRefineStatus(avail ? 'available' : 'unavailable');
        setAvailableProviders(Array.isArray(cfg.providers) ? cfg.providers : []);
      })
      .catch(() => {
        refineEnabledRef.current = false;
        setServerRefineAvailable(false);
        setServerRefineStatus('unreachable');
      });
  }, []);

  useEffect(() => {
    void refreshServerConfig();
  }, [refreshServerConfig]);

  useEffect(() => {
    if (isVoiceSettingsOpen && serverRefineStatus !== 'available') {
      void refreshServerConfig();
    }
  }, [isVoiceSettingsOpen, serverRefineStatus, refreshServerConfig]);

  return {
    availableProviders, refineEnabledRef, serverRefineAvailable, serverRefineStatus,
    geminiRefineEnabled, geminiRefineEnabledRef, setGeminiRefineEnabled,
  };
}
