// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectDiagnostics, describeBrowser, resetReportContext, setReportContext } from './diagnostics';

afterEach(() => {
  vi.restoreAllMocks();
  resetReportContext();
});

describe('report diagnostics', () => {
  it('names the browser and system with a major version only', () => {
    expect(describeBrowser('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36'))
      .toEqual({ browser: 'Chrome 142', os: 'ChromeOS' });
    expect(describeBrowser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.53'))
      .toEqual({ browser: 'Edge 142', os: 'Windows' });
    expect(describeBrowser('Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'))
      .toEqual({ browser: 'Safari 18', os: 'iOS / iPadOS' });
    expect(describeBrowser('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:133.0) Gecko/20100101 Firefox/133.0'))
      .toEqual({ browser: 'Firefox 133', os: 'macOS' });
  });

  it('reports feature status from the page and leaves out what it does not know', async () => {
    setReportContext({ page: 'Student room', view: 'Student room', languages: ['pt'], translator: 'auto' });
    const diagnostics = await collectDiagnostics('rev-7');
    expect(diagnostics).toMatchObject({
      appVersion: 'rev-7', page: 'Student room', languages: 'pt', translator: 'auto', online: 'yes',
      microphone: 'unknown',
    });
    expect(diagnostics).not.toHaveProperty('listening');
    expect(diagnostics).not.toHaveProperty('lastTranslator');
  });
});
