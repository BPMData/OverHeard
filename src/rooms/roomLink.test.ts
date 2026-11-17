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
    for (const path of ['/', '/sw.js', '/favicon.ico', '/ab', '/api', '/assets', '/ort/x', '/a/b/c']) {
      expect(at(path)).toBeNull();
    }
  });

  it('builds a short, typeable student address', () => {
    expect(studentRoomUrl('Murphy-P3', 'https://overheard.example')).toBe('https://overheard.example/murphy-p3');
    expect(displayRoomUrl('murphy-p3', 'https://overheard.example')).toBe('overheard.example/murphy-p3');
  });
});
