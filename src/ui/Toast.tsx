import { useEffect } from 'react';
import { Icon } from './Icon';

/**
 * Brief confirmation for actions that otherwise finish in silence, optionally
 * carrying the action that reverses them. Deletion in particular must always
 * offer a way back — swiping a row is the easiest gesture in the app.
 */
export function Toast({
  message,
  onDone,
  actionLabel,
  onAction,
  ms = 2600,
}: {
  message: string;
  onDone: () => void;
  actionLabel?: string;
  onAction?: () => void;
  ms?: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, ms);
    return () => clearTimeout(t);
  }, [onDone, ms]);

  return (
    <div className="toast" role="status">
      <span className="tick">
        <Icon name="check" size={19} strokeWidth={2.4} />
      </span>
      <span className="toast-msg">{message}</span>
      {actionLabel && onAction && (
        <button className="toast-action" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
