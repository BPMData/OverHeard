// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaptionSegment, LanguageCode, PipLine } from '../types';
import { PipSubtitlePortal } from './PipSubtitlePortal';

afterEach(cleanup);

const segment: CaptionSegment = {
  id: 1,
  timestamp: '10:00:00',
  english: 'Open your books.',
  translations: { es: 'Abran sus libros.', pt: 'Abram seus livros.', ar: 'افتحوا كتبكم.' },
  status: 'done',
};

function renderPip(
  overrides: Partial<{
    visibleLines: PipLine[];
    selectedLangs: LanguageCode[];
    interimTranscript: string;
    liveTranslations: Record<string, string>;
    currentSegment: CaptionSegment | null;
    onToggleLine: (line: PipLine) => void;
    layout: 'stacked' | 'columns';
    onToggleLayout: () => void;
  }> = {}
) {
  const onToggleLine = overrides.onToggleLine ?? vi.fn();
  const onToggleLayout = overrides.onToggleLayout ?? vi.fn();
  render(
    <PipSubtitlePortal
      // The portal renders into this window's body, so the test document works as the pop-out
      pipWindow={window}
      onClosePip={vi.fn()}
      isDark
      isListening
      onToggleListening={vi.fn()}
      fontSize={32}
      onAdjustFont={vi.fn()}
      selectedLangs={overrides.selectedLangs ?? ['es', 'pt', 'ar']}
      visibleLines={overrides.visibleLines ?? ['en', 'es', 'pt']}
      onToggleLine={onToggleLine}
      layout={overrides.layout}
      onToggleLayout={onToggleLayout}
      currentSegment={overrides.currentSegment ?? segment}
      interimTranscript={overrides.interimTranscript ?? ''}
      liveTranslations={overrides.liveTranslations ?? {}}
    />
  );
  return { onToggleLine, onToggleLayout };
}

const toggles = () => within(screen.getByRole('group', { name: 'Lines to show' }));

describe('PipSubtitlePortal', () => {
  it('shows English plus up to two languages', () => {
    renderPip();
    expect(screen.getByText('Open your books.')).toBeTruthy();
    expect(screen.getByText('Abran sus libros.')).toBeTruthy();
    expect(screen.getByText('Abram seus livros.')).toBeTruthy();
    expect(screen.queryByText('افتحوا كتبكم.')).toBeNull();
  });

  it('can show translations with no English', () => {
    renderPip({ visibleLines: ['es', 'pt', 'ar'] });
    expect(screen.queryByText('Open your books.')).toBeNull();
    expect(screen.getByText('افتحوا كتبكم.')).toBeTruthy();
  });

  it('labels each translation only when more than one is shown', () => {
    renderPip({ visibleLines: ['en', 'es', 'pt'] });
    expect(screen.getByText('es')).toBeTruthy();
    cleanup();
    renderPip({ visibleLines: ['en', 'es'] });
    expect(screen.queryByText('es')).toBeNull();
  });

  it('marks shown lines as pressed and reports toggle clicks', () => {
    const { onToggleLine } = renderPip();
    const english = toggles().getByRole('button', { name: 'English' });
    expect(english.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(english);
    expect(onToggleLine).toHaveBeenCalledWith('en');
  });

  it('disables adding a fourth line and removing the last one', () => {
    renderPip();
    expect(
      (toggles().getByRole('button', { name: 'Arabic' }) as HTMLButtonElement).disabled
    ).toBe(true);
    cleanup();
    renderPip({ visibleLines: ['es'] });
    expect(
      (toggles().getByRole('button', { name: 'Spanish' }) as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('shows live translations while the teacher is still talking', () => {
    renderPip({
      interimTranscript: 'Close your',
      liveTranslations: { es: 'Cierren sus', pt: 'Fechem seus' },
    });
    expect(screen.getByText('Close your')).toBeTruthy();
    expect(screen.getByText('Cierren sus')).toBeTruthy();
    expect(screen.getByText('Fechem seus')).toBeTruthy();
    expect(screen.queryByText('Abran sus libros.')).toBeNull();
  });

  it('shows Translating… for a language that has not arrived yet', () => {
    renderPip({
      currentSegment: { ...segment, translations: { es: 'Abran sus libros.' }, status: 'translating' },
    });
    expect(screen.getByText('Translating…')).toBeTruthy();
  });

  it('renders right-to-left languages right to left', () => {
    renderPip({ visibleLines: ['ar'] });
    expect(screen.getByText('افتحوا كتبكم.').closest('[dir]')?.getAttribute('dir')).toBe('rtl');
  });

  it('toggles between stacked and side-by-side equal columns when multiple lines are visible', () => {
    const { onToggleLayout } = renderPip({ visibleLines: ['en', 'es'], layout: 'stacked' });
    const btn = screen.getByRole('button', { name: /Side by side columns/i });
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(document.querySelector('[data-layout="stacked"]')).toBeTruthy();
    fireEvent.click(btn);
    expect(onToggleLayout).toHaveBeenCalledTimes(1);

    cleanup();
    renderPip({ visibleLines: ['en', 'es', 'pt'], layout: 'columns' });
    const activeBtn = screen.getByRole('button', { name: /Side by side columns/i });
    expect(activeBtn.getAttribute('aria-pressed')).toBe('true');
    const grid = document.querySelector('[data-layout="columns"]') as HTMLElement;
    expect(grid).toBeTruthy();
    expect(grid.style.gridTemplateColumns).toMatch(/^repeat\(3, minmax\(0(px)?, 1fr\)\)$/);

    cleanup();
    renderPip({ visibleLines: ['es'] });
    expect(screen.queryByRole('button', { name: /Side by side/i })).toBeNull();
  });
});
