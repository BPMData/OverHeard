import { describe, expect, it } from 'vitest';
import {
  emptyTracker,
  finalRemainder,
  LIVE_SPEECH_LINGER_MS,
  LIVE_SPEECH_MAX_WORDS,
  LIVE_SPEECH_STABLE_MS,
  nextLiveSegment,
  stableWordCount,
  trackWords,
} from './liveSegments';

describe('live read-aloud segments', () => {
  it('keeps timestamps of unchanged words and resets revised ones', () => {
    let tracker = trackWords(emptyTracker(), 'open your box', 0);
    tracker = trackWords(tracker, 'Open your books today', 500);
    expect(tracker.changedAt).toEqual([0, 0, 500, 500]);
  });

  it('waits for settled words, then speaks a few at a time', () => {
    let tracker = trackWords(emptyTracker(), 'today we will look at', 0);
    expect(nextLiveSegment(tracker, 0, LIVE_SPEECH_STABLE_MS - 1)).toBeNull();
    expect(nextLiveSegment(tracker, 0, LIVE_SPEECH_STABLE_MS)).toEqual({ start: 0, end: 5 });

    tracker = trackWords(tracker, 'today we will look at the water cycle', 1000);
    expect(stableWordCount(tracker, 1000 + LIVE_SPEECH_STABLE_MS)).toBe(8);
    // Only 3 new settled words: wait for more, unless the speaker stops for a while
    expect(nextLiveSegment(tracker, 5, 1000 + LIVE_SPEECH_STABLE_MS)).toBeNull();
    expect(nextLiveSegment(tracker, 5, 1000 + LIVE_SPEECH_LINGER_MS)).toEqual({ start: 5, end: 8 });
  });

  it('caps a burst of settled words', () => {
    const words = Array.from({ length: 40 }, (_, i) => `w${i}`).join(' ');
    const tracker = trackWords(emptyTracker(), words, 0);
    expect(nextLiveSegment(tracker, 0, 5000)).toEqual({ start: 0, end: LIVE_SPEECH_MAX_WORDS });
  });

  it('speaks only the unspoken end of a finalized line', () => {
    expect(finalRemainder('Today we will look at the water cycle.', 5)).toEqual({ remainder: 'the water cycle.', carry: 0 });
    // Chrome finalized only part of what had already been read
    expect(finalRemainder('Today we', 5)).toEqual({ remainder: '', carry: 3 });
  });
});
