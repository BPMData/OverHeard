// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { copyStylesInto } from './copyStyles';

const blankDoc = () => document.implementation.createHTMLDocument('pop-out');

describe('copyStylesInto', () => {
  it('copies readable sheets as inline rules, even ones the page loaded from a file', () => {
    const fakeSource = {
      styleSheets: [
        // A built CSS file: it has an href, but the pop-out must not fetch it again
        { href: 'https://example.test/assets/index-OLD.css', cssRules: [{ cssText: '.dark .pip { color: white; }' }] },
      ],
    } as unknown as Document;
    const target = blankDoc();
    copyStylesInto(target, fakeSource);
    expect(target.head.querySelector('link')).toBeNull();
    expect(target.head.querySelector('style')?.textContent).toContain('.dark .pip { color: white; }');
  });

  it('links cross-origin sheets whose rules cannot be read', () => {
    const fontSheet = {
      href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans',
      get cssRules(): CSSRuleList {
        throw new DOMException('cross-origin', 'SecurityError');
      },
    };
    const target = blankDoc();
    copyStylesInto(target, { styleSheets: [fontSheet] } as unknown as Document);
    expect(target.head.querySelector('link')?.getAttribute('href')).toBe(fontSheet.href);
    expect(target.head.querySelector('style')).toBeNull();
  });

  it('copies the real page styles', () => {
    const style = document.createElement('style');
    style.textContent = '.oh-pip-header { opacity: 0; }';
    document.head.appendChild(style);
    const target = blankDoc();
    copyStylesInto(target);
    expect(target.head.textContent).toContain('.oh-pip-header');
    style.remove();
  });
});
