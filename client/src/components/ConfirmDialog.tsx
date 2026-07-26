import { useEffect, type ReactNode } from 'react';

// Modal confirmation for a destructive action. The backdrop and Escape both
// cancel — never confirm — so a stray tap can't delete anything.
export function ConfirmDialog({
  title, message, confirmLabel, busy = false, error, onConfirm, onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="confirm-backdrop" onClick={onCancel} role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-box" onClick={e => e.stopPropagation()}>
        <div className="confirm-title">{title}</div>
        <p className="confirm-msg">{message}</p>
        {error && <div className="auth-error">{error}</div>}
        <div className="confirm-actions">
          <button className="btn-danger" onClick={onConfirm} disabled={busy}>
            {busy ? 'Deleting…' : confirmLabel}
          </button>
          <button className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
