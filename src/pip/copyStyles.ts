/**
 * Give a pop-out window the page's styles.
 *
 * Same-origin sheets are copied as inline rules from the copy already loaded in this page,
 * never re-fetched by URL. A page that has been open across a deploy (or opened from the
 * service worker's saved copy) still points at the previous build's CSS file, which the
 * server no longer has, so a <link> to it leaves the pop-out completely unstyled.
 * Only cross-origin sheets whose rules can't be read (Google Fonts) are linked.
 */
export function copyStylesInto(target: Document, source: Document = document) {
  for (const sheet of Array.from(source.styleSheets)) {
    let cssText: string | null = null;
    try {
      cssText = Array.from(sheet.cssRules).map((rule) => rule.cssText).join('\n');
    } catch {
      cssText = null; // Cross-origin sheet: its rules can't be read from here
    }
    if (cssText !== null) {
      const style = target.createElement('style');
      style.textContent = cssText;
      target.head.appendChild(style);
    } else if (sheet.href) {
      const link = target.createElement('link');
      link.rel = 'stylesheet';
      link.href = sheet.href;
      target.head.appendChild(link);
    }
  }
}
