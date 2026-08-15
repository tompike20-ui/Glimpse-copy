import { useEffect } from 'react';
import { Icon } from './Icon';

/**
 * Brief confirmation for actions that otherwise finish in silence. Exporting
 * used to hand the file to the share sheet and say nothing, which reads as a
 * bug rather than success.
 */
export function Toast({
  message,
  onDone,
  ms = 2600,
}: {
  message: string;
  onDone: () => void;
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
      {message}
    </div>
  );
}
