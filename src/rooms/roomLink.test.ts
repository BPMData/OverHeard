// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { displayRoomUrl, roomCodeFromLocation, studentRoomUrl } from './roomLink';

const at = (pathname: string, search = '') => roomCodeFromLocation({ pathname, search });

describe('room links', () => {
  it('reads the original query link and the short path link', () => {
    expect(at('/', '?room=Science-101')).toBe('science-101');
    expect(at('/Murphy-P3')).toBe('murphy-p3');
    expect(at('/murphy-p3/')).toBe('murphy-p3');
  });

  it('ignores the home page, files, nested paths and reserved names', () => {
    for (const path of ['/', '/sw.js', '/favicon.ico', '/ab', '/api', '/assets', '/ort/x', '/a/b/c', '/overheard', '/AllAboard']) {
      expect(at(path)).toBeNull();
    }
  });

  it('builds a short, typeable student address', () => {
    expect(studentRoomUrl('Murphy-P3', 'https://bpmdata.github.io')).toBe('https://bpmdata.github.io/murphy-p3');
    expect(studentRoomUrl('murphy-p3')).toBe(`${window.location.origin}/murphy-p3`);
    expect(displayRoomUrl('murphy-p3', 'https://overheard.example')).toBe('overheard.example/murphy-p3');
  });
});

describe('reserved room codes', () => {
  it('refuses names used by the app or the GitHub Pages site', async () => {
    const { isReservedRoomCode } = await import('./protocol');
    expect(isReservedRoomCode('OverHeard')).toBe(true);
    expect(isReservedRoomCode('privacy')).toBe(true);
    expect(isReservedRoomCode('murphy-p3')).toBe(false);
  });
});
