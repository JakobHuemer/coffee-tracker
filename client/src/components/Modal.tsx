import { useEffect, type ReactNode } from 'react';
import { Icon } from './Icon';

// A plain content modal (distinct from ConfirmDialog, which is purpose-built for
// a yes/no destructive prompt). Used for admin add/edit forms — a multi-field
// form belongs in a modal rather than a permanent inline block. Backdrop and
// Escape both close; the box scrolls if the form is taller than the viewport.
export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="confirm-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="admin-modal-box" onClick={e => e.stopPropagation()}>
        <div className="admin-modal-head">
          <div className="confirm-title">{title}</div>
          <button type="button" className="admin-modal-close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
