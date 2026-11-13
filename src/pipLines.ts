import { LanguageCode, PipLine } from './types';

/** On-screen order: English first, then languages in the order they were selected. */
export const pipLineOrder = (selectedLangs: LanguageCode[]): PipLine[] => [
  'en',
  ...selectedLangs,
];

/**
 * Lines the pop-out should show: the saved choice, minus languages no longer selected,
 * in on-screen order and capped at `max`. Falls back to the first `max` lines if nothing is left.
 */
export function visiblePipLines(
  saved: PipLine[],
  selectedLangs: LanguageCode[],
  max: number
): PipLine[] {
  const order = pipLineOrder(selectedLangs);
  const kept = order.filter((line) => saved.includes(line));
  return (kept.length > 0 ? kept : order).slice(0, max);
}

/**
 * Result of clicking a line's toggle, or null when the click should do nothing
 * (hiding the last visible line, or showing a line when already at `max`).
 */
export function togglePipLine(
  visible: PipLine[],
  line: PipLine,
  selectedLangs: LanguageCode[],
  max: number
): PipLine[] | null {
  if (visible.includes(line)) {
    if (visible.length === 1) return null;
    return visible.filter((l) => l !== line);
  }
  if (visible.length >= max) return null;
  return pipLineOrder(selectedLangs).filter((l) => l === line || visible.includes(l));
}
