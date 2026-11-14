export type MicBlock = 'denied' | 'insecure';

/**
 * Ask for the microphone explicitly before starting speech recognition.
 *
 * Android Chrome often fails `SpeechRecognition.start()` with `not-allowed` without ever
 * showing a permission prompt. `getUserMedia` reliably shows it. Call this straight from the
 * click so the prompt counts as user-initiated. The test stream is closed right away;
 * recognition opens its own.
 *
 * Where `getUserMedia` isn't available, recognition starts synchronously as before, unless the
 * page isn't a secure context (plain http on a LAN address), where browsers block the mic outright.
 */
export function withMicAccess(onGranted: () => void, onBlocked: (reason: MicBlock) => void) {
  if (window.isSecureContext === false) {
    onBlocked('insecure');
    return;
  }
  const getUserMedia = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
  if (!getUserMedia) {
    onGranted();
    return;
  }
  getUserMedia({ audio: true }).then(
    (stream) => {
      stream.getTracks().forEach((track) => track.stop());
      onGranted();
    },
    (error: unknown) => {
      const name = (error as { name?: string })?.name;
      // No mic / mic busy: let recognition try and report its own error
      if (name === 'NotAllowedError' || name === 'SecurityError') onBlocked('denied');
      else onGranted();
    },
  );
}
