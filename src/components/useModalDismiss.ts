import { useEffect, useRef, type MouseEvent } from 'react';

const MARKER = 'overheardModal';

/**
 * Close a modal the ways people expect: Escape, a tap on the dimmed backdrop, and the phone or
 * tablet Back button. Back works by adding a history entry (same URL) while the modal is open,
 * so Back pops that entry and closes the modal instead of leaving the page. Closing any other
 * way removes the entry again. Returns the backdrop's onClick handler.
 */
export function useModalDismiss(isOpen: boolean, onClose: () => void): (event: MouseEvent) => void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    const id = Math.random().toString(36).slice(2);
    const base: unknown = window.history.state;
    window.history.pushState({ ...(base && typeof base === 'object' ? base : {}), [MARKER]: id }, '');
    let poppedByBack = false;
    const onPopState = () => {
      poppedByBack = true;
      closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('keydown', onKeyDown);
      const state: unknown = window.history.state;
      const ours = !!state && typeof state === 'object' && (state as Record<string, unknown>)[MARKER] === id;
      if (!poppedByBack && ours) window.history.back();
    };
  }, [isOpen]);

  // Only a tap on the backdrop itself, not one that bubbled up from inside the panel
  return (event) => {
    if (event.target === event.currentTarget) closeRef.current();
  };
}
