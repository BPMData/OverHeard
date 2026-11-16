// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AboutModal } from './AboutModal';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AboutModal (Guide & FAQ)', () => {
  it('documents accurate Spacebar behavior and universal Pop out captions window', () => {
    const onClose = vi.fn();
    render(<AboutModal isOpen onClose={onClose} isEmbeddedIframe={false} />);

    expect(screen.getByText(/How to Use OverHeard — Guide & FAQ/i)).toBeTruthy();

    // Clarifies Spacebar does not toggle Start/Stop in Two-Way Manual or Lecture mode
    expect(screen.getAllByText(/Manual \(Press Space\)/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Spacebar in Conversation \/ Lecture Mode/i)).toBeTruthy();

    // Clarifies Pop out captions floats above everything on screen (not just slides)
    expect(screen.getByText(/floats above everything on your screen/i)).toBeTruthy();
    expect(screen.getByText(/other desktop windows/i)).toBeTruthy();

    // Quick jump pills scroll to section smoothly
    const scrollIntoView = vi.fn();
    const faqSection = document.getElementById('guide-faq');
    expect(faqSection).toBeTruthy();
    if (faqSection) faqSection.scrollIntoView = scrollIntoView;
    fireEvent.click(screen.getByRole('button', { name: 'FAQ & Privacy' }));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
