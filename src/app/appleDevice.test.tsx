// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppleMobile, isAppleMobileNotSafari } from './appleDevice';
import { AppBanners } from './AppBanners';
import { PermissionBanner } from './PermissionBanner';

const IPAD_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const IPAD_CHROME =
  'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function pretend(ua: string, platform: string, touchPoints: number) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(ua);
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  Object.defineProperty(navigator, 'maxTouchPoints', { value: touchPoints, configurable: true });
}
const banners = (hasSpeechApi = true) =>
  render(
    <AppBanners
      displayMode="conversation"
      isEmbeddedIframe={false}
      hasSpeechApi={hasSpeechApi}
      isSupportedBrowser={false}
      importError=""
      pipNotice={null}
      permissionBanner={null}
      setImportError={() => {}}
      setPipNotice={() => {}}
    />
  );

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('iPhone and iPad speech help', () => {
  it('recognises an iPad, which reports itself as a Mac with a touch screen', () => {
    expect(isAppleMobile(IPAD_SAFARI, 'MacIntel', 5)).toBe(true);
    expect(isAppleMobile(IPAD_SAFARI, 'MacIntel', 0)).toBe(false); // a real Mac
    expect(isAppleMobile(IPAD_CHROME, 'iPad', 5)).toBe(true);
    expect(isAppleMobile(ANDROID_CHROME, 'Linux armv8l', 5)).toBe(false);
    expect(isAppleMobileNotSafari(IPAD_CHROME)).toBe(true);
    expect(isAppleMobileNotSafari(IPAD_SAFARI)).toBe(false);
  });

  it('tells Chrome on an iPad to use Safari and how to turn on Dictation, even in Two-way', () => {
    pretend(IPAD_CHROME, 'iPad', 5);
    banners();
    expect(screen.getByRole('note').textContent).toMatch(/open OverHeard in Safari/);
    expect(screen.getByRole('note').textContent).toMatch(/Enable Dictation/);
    expect(screen.queryByText(/designed for/)).toBeNull();
  });

  it('says nothing in Safari on an iPad while speech is available', () => {
    pretend(IPAD_SAFARI, 'MacIntel', 5);
    banners();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('shows the Dictation steps in Safari when speech recognition is missing', () => {
    pretend(IPAD_SAFARI, 'MacIntel', 5);
    banners(false);
    expect(screen.getByRole('note').textContent).toMatch(/Speech recognition is off.*Enable Dictation/);
  });

  it('explains Dictation and Siri when speech is blocked on an iPad', () => {
    pretend(IPAD_SAFARI, 'MacIntel', 5);
    render(<PermissionBanner displayMode="conversation" isEmbeddedIframe={false} micInsecure={false} />);
    expect(document.body.textContent).toMatch(/Enable Dictation/);
    expect(document.body.textContent).toMatch(/Siri/);
    expect(document.body.textContent).not.toMatch(/Android/);
  });
});
