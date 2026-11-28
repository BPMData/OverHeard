import { useEffect, useId, useState, useSyncExternalStore, type ReactNode } from 'react';
import { MoreHorizontal, X } from 'lucide-react';

/** A phone: a narrow screen, or a short one held sideways. Keep in step with index.css. */
export const PHONE_QUERY = '(max-width: 639px), (max-height: 500px) and (max-width: 1023px)';

function subscribe(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const isPhoneNow = () => typeof window !== 'undefined' && !!window.matchMedia?.(PHONE_QUERY).matches;

/** True on a phone-sized screen; follows rotation. Always false where matchMedia is missing. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(subscribe, isPhoneNow, () => false);
}

/**
 * On a phone, the less-used controls wait behind one "More" button and pop up as a sheet
 * from the bottom of the screen. Callers render it only on a phone (useIsPhone) and keep
 * their usual inline controls everywhere else, so tablet and desktop layouts don't change.
 */
export function PhoneMenu({
  children,
  label = 'More',
  title = 'More controls',
}: {
  children: ReactNode;
  label?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened from inside the sheet closes first
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`oh-phone-more${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-controls={id}
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="w-4 h-4" aria-hidden="true" />
        <span>{label}</span>
      </button>
      {/* Kept mounted while closed, so a file picker started from inside survives closing */}
      <div className="oh-phone-backdrop" hidden={!open} aria-hidden="true" onClick={() => setOpen(false)} />
      <div id={id} className="oh-phone-sheet" role="group" aria-label={title} hidden={!open}>
        <div className="oh-phone-sheet-head">
          <span>{title}</span>
          <button type="button" aria-label="Close more controls" onClick={() => setOpen(false)}>
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </>
  );
}

/** A labeled group of controls inside the phone sheet. */
export function PhoneMenuSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="oh-phone-sheet-section">
      <h3>{title}</h3>
      {children}
    </div>
  );
}
