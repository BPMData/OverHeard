import { describe, expect, it } from 'vitest';
import {
  captionTextStyle,
  LANGUAGE_CAPTION_COLORS,
  languageCaptionColor,
} from './captionColors';

describe('languageCaptionColor', () => {
  it('gives each selected language a different color: blue, then yellow, then pink', () => {
    expect(languageCaptionColor(0)).toBe('#38BDF8');
    expect(languageCaptionColor(1)).toBe('#FDE047');
    expect(languageCaptionColor(2)).toBe('#F472B6');
    expect(new Set([0, 1, 2].map(languageCaptionColor)).size).toBe(3);
  });

  it('wraps around instead of failing for out-of-range indexes', () => {
    expect(languageCaptionColor(LANGUAGE_CAPTION_COLORS.length)).toBe(languageCaptionColor(0));
    expect(languageCaptionColor(-1)).toBe(
      LANGUAGE_CAPTION_COLORS[LANGUAGE_CAPTION_COLORS.length - 1]
    );
  });
});

describe('captionTextStyle', () => {
  it('uses the plain color on a dark background', () => {
    expect(captionTextStyle('#FDE047', true)).toEqual({ color: '#FDE047' });
  });

  it('puts the same color on a black highlight in light mode', () => {
    const style = captionTextStyle('#FDE047', false);
    expect(style.color).toBe('#FDE047');
    expect(style.backgroundColor).toBe('#000000');
    expect(style.boxDecorationBreak).toBe('clone');
  });
});
