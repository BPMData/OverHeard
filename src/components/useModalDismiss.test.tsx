// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { useModalDismiss } from './useModalDismiss';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  const close = () => {
    onClose();
    setOpen(false);
  };
  const onBackdrop = useModalDismiss(open, close);
  if (!open) return null;
  return (
    <div data-testid="backdrop" onClick={onBackdrop}>
      <div data-testid="panel">
        <button onClick={close}>Done</button>
      </div>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useModalDismiss', () => {
  it('closes on a backdrop tap but not on a tap inside the panel', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByTestId('panel'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on the Back button without going back again', () => {
    const back = vi.spyOn(window.history, 'back');
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it('removes its history entry when closed another way', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const pushed = window.history.length;
    render(<Harness onClose={() => {}} />);
    expect(window.history.length).toBe(pushed + 1);
    fireEvent.click(screen.getByText('Done'));
    expect(back).toHaveBeenCalledTimes(1);
  });
});
