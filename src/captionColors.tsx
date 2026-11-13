import React from 'react';

// High-visibility caption palette, in the spirit of broadcast subtitles.
// English is always white; translations take colors in the order their languages
// were selected. Blue, yellow and pink stay distinguishable for the common forms of
// color blindness, and every language is also labeled, so color is never the only cue.
export const ENGLISH_CAPTION_COLOR = '#FFFFFF';
export const LANGUAGE_CAPTION_COLORS = [
  '#38BDF8', // 1st language: sky blue (the app's accent)
  '#FDE047', // 2nd language: classic caption yellow
  '#F472B6', // 3rd language: bright pink
  '#4ADE80', // spare: bright green
] as const;

/** Caption color for the language at `index` in the selected list. */
export const languageCaptionColor = (index: number): string =>
  LANGUAGE_CAPTION_COLORS[
    ((index % LANGUAGE_CAPTION_COLORS.length) + LANGUAGE_CAPTION_COLORS.length) %
      LANGUAGE_CAPTION_COLORS.length
  ];

/**
 * Style for caption text. On a dark background the color is used as-is. On a light
 * background these bright colors would wash out, so the text sits on a black
 * highlight, like broadcast captions, and keeps the same color in both themes.
 */
export function captionTextStyle(color: string, isDark: boolean): React.CSSProperties {
  if (isDark) return { color };
  return {
    color,
    backgroundColor: '#000000',
    padding: '0.04em 0.28em',
    borderRadius: '0.18em',
    boxDecorationBreak: 'clone',
    WebkitBoxDecorationBreak: 'clone',
  };
}

/** Inline caption text in a palette color (wrap inside the block that sets size and layout). */
export const CaptionText: React.FC<{
  color: string;
  isDark: boolean;
  children: React.ReactNode;
}> = ({ color, isDark, children }) => (
  <span style={captionTextStyle(color, isDark)}>{children}</span>
);

/** Small color dot used next to language names so headers match their caption color. */
export const CaptionSwatch: React.FC<{ color: string }> = ({ color }) => (
  <span
    aria-hidden="true"
    className="inline-block w-3 h-3 rounded-full ring-1 ring-black/40 shrink-0"
    style={{ backgroundColor: color }}
  />
);
