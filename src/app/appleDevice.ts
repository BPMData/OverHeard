/**
 * iPhone and iPad browsers all run on Safari's engine, but only Safari itself offers speech
 * recognition; Chrome, Firefox and Edge there have none. iPadOS reports itself as a Mac, so a
 * touch screen marks it.
 */
export function isAppleMobile(
  ua = navigator.userAgent,
  platform = navigator.platform,
  touchPoints = navigator.maxTouchPoints ?? 0
): boolean {
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && touchPoints > 1);
}

/** Another browser's app on an iPhone or iPad (Chrome, Firefox, Edge, Opera, …). */
export function isAppleMobileNotSafari(ua = navigator.userAgent): boolean {
  return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|Brave/.test(ua);
}
