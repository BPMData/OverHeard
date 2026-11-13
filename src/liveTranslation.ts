export const wordCount = (text: string): number =>
  text.trim().split(/\s+/).filter(Boolean).length;

/**
 * True when a run-on interim sentence has grown enough since the last send that it
 * should be translated now instead of waiting for the speaker to pause.
 */
export const shouldSendImmediately = (
  interim: string,
  lastSent: string,
  wordStep: number
): boolean => wordCount(interim) - wordCount(lastSent) >= wordStep;
