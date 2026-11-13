import { describe, expect, it } from 'vitest';
import { togglePipLine, visiblePipLines } from './pipLines';

describe('visiblePipLines', () => {
  it('keeps saved lines in on-screen order (English first, then selection order)', () => {
    expect(visiblePipLines(['pt', 'en', 'es'], ['es', 'pt'], 3)).toEqual(['en', 'es', 'pt']);
  });

  it('drops languages that are no longer selected', () => {
    expect(visiblePipLines(['en', 'ar'], ['es', 'pt'], 3)).toEqual(['en']);
  });

  it('falls back to the first lines when nothing saved is still valid', () => {
    expect(visiblePipLines(['ar'], ['es', 'pt', 'zh'], 3)).toEqual(['en', 'es', 'pt']);
  });

  it('never shows more than the max', () => {
    expect(visiblePipLines(['en', 'es', 'pt', 'zh'], ['es', 'pt', 'zh'], 3)).toEqual([
      'en',
      'es',
      'pt',
    ]);
  });
});

describe('togglePipLine', () => {
  it('hides a visible line', () => {
    expect(togglePipLine(['en', 'es', 'pt'], 'en', ['es', 'pt'], 3)).toEqual(['es', 'pt']);
  });

  it('shows a hidden line in its on-screen position', () => {
    expect(togglePipLine(['es', 'pt'], 'en', ['es', 'pt'], 3)).toEqual(['en', 'es', 'pt']);
    expect(togglePipLine(['en', 'pt'], 'es', ['es', 'pt'], 3)).toEqual(['en', 'es', 'pt']);
  });

  it('refuses to hide the last visible line', () => {
    expect(togglePipLine(['es'], 'es', ['es', 'pt'], 3)).toBeNull();
  });

  it('refuses to add a line when already at the max', () => {
    expect(togglePipLine(['en', 'es', 'pt'], 'ar', ['es', 'pt', 'ar'], 3)).toBeNull();
  });

  it('supports translations only, with no English', () => {
    let lines = togglePipLine(['en', 'es', 'pt'], 'en', ['es', 'pt', 'ar'], 3)!;
    lines = togglePipLine(lines, 'ar', ['es', 'pt', 'ar'], 3)!;
    expect(lines).toEqual(['es', 'pt', 'ar']);
  });
});
