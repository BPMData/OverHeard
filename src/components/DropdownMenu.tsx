import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A button that opens a small panel under it. The panel stays mounted while closed so a
 * file picker or Drive picker started from inside it survives the panel closing.
 */
export function DropdownMenu({
  label, icon, title, children, closeOnClick = true, align = 'left', panelLabel,
}: {
  label: ReactNode;
  icon?: ReactNode;
  title?: string;
  children: ReactNode;
  /** Close when anything inside is clicked (menus). Off for panels holding selects. */
  closeOnClick?: boolean;
  align?: 'left' | 'right';
  panelLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="oh-menu">
      <button
        type="button"
        className={`oh-menu-trigger${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        title={title}
        onClick={() => setOpen((v) => !v)}
      >
        {icon}
        <span>{label}</span>
        <ChevronDown className={`oh-menu-chevron${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      <div
        className={`oh-menu-panel${align === 'right' ? ' is-right' : ''}`}
        hidden={!open}
        role="group"
        aria-label={panelLabel}
        onClick={closeOnClick ? (event) => {
          if ((event.target as HTMLElement).closest('button')) setOpen(false);
        } : undefined}
      >
        {children}
      </div>
    </div>
  );
}

/** A small (i) button that shows a short explanation in a popover. */
export function InfoPopover({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={rootRef} className="oh-menu oh-info">
      <button
        type="button"
        className={`oh-info-btn${open ? ' is-open' : ''}`}
        aria-label={label}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        i
      </button>
      {open && (
        <span className="oh-menu-panel oh-info-panel" role="note">
          {children}
        </span>
      )}
    </span>
  );
}
