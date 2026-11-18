import { useEffect, useState } from 'react';

export function useBrowserSupport() {
  // Environment checks
  const [isSupportedBrowser, setIsSupportedBrowser] = useState<boolean>(true);
  const [hasSpeechApi, setHasSpeechApi] = useState<boolean>(true);
  const [hasPipApi, setHasPipApi] = useState<boolean>(false);
  const [isEmbeddedIframe, setIsEmbeddedIframe] = useState<boolean>(false);

  // Initial browser capability detection
  useEffect(() => {
    const ua = navigator.userAgent;
    const isChromeOrEdge =
      (/Chrome\//.test(ua) || /Edg\//.test(ua) || /CriOS\//.test(ua)) &&
      !/OPR\//.test(ua);
    const speechAvailable = Boolean(
      window.SpeechRecognition || window.webkitSpeechRecognition
    );

    setIsSupportedBrowser(isChromeOrEdge && speechAvailable);
    setHasSpeechApi(speechAvailable);
    setHasPipApi(Boolean(window.documentPictureInPicture));

    try {
      setIsEmbeddedIframe(window.self !== window.top);
    } catch {
      setIsEmbeddedIframe(true);
    }
  }, []);

  return { isSupportedBrowser, hasSpeechApi, setHasSpeechApi, hasPipApi, isEmbeddedIframe };
}
