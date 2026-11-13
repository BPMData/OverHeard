import { describe, expect, it } from 'vitest';
import { isFailedSession, restartDelay } from './speechRestart';

describe('isFailedSession', () => {
  it('treats a normal end after speaking as healthy', () => {
    expect(isFailedSession(null, 8000)).toBe(false);
    expect(isFailedSession('no-speech', 8000)).toBe(false);
  });

  it('treats network errors and near-instant ends as failures', () => {
    expect(isFailedSession('network', 8000)).toBe(true);
    expect(isFailedSession(null, 200)).toBe(true);
  });
});

describe('restartDelay', () => {
  it('restarts immediately when nothing has failed', () => {
    expect(restartDelay(0)).toBe(0);
  });

  it('backs off exponentially and caps at 5 seconds', () => {
    expect(restartDelay(1)).toBe(300);
    expect(restartDelay(2)).toBe(600);
    expect(restartDelay(3)).toBe(1200);
    expect(restartDelay(10)).toBe(5000);
  });
});
