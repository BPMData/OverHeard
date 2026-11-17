import { describe, expect, it } from 'vitest';
import { shortLinkBase } from './shortLink.ts';

describe('shortLinkBase', () => {
  it('uses GitHub Pages only for the production service unless overridden', () => {
    expect(shortLinkBase({ K_SERVICE: 'over-heard' })).toBe('https://bpmdata.github.io');
    expect(shortLinkBase({ K_SERVICE: 'over-heard-staging' })).toBeNull();
    expect(shortLinkBase({})).toBeNull();
    expect(shortLinkBase({ K_SERVICE: 'over-heard', SHORT_LINK_BASE: '' })).toBeNull();
    expect(shortLinkBase({ SHORT_LINK_BASE: 'https://overheard.example/' })).toBe('https://overheard.example');
  });

  it('rejects unusable values', () => {
    expect(shortLinkBase({ SHORT_LINK_BASE: 'not a url' })).toBeNull();
    expect(shortLinkBase({ SHORT_LINK_BASE: 'http://insecure.example' })).toBeNull();
  });
});
