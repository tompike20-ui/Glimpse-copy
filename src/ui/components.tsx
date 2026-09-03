import { Icon } from './Icon';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/* ------------------------------------------------------------- nav bar */

/**
 * Large title that collapses into an inline title on scroll, the way system
 * navigation bars behave. The scroll container reports its offset rather than
 * the bar listening globally, so several screens can use it independently.
 */
export function NavBar({
  title,
  subtitle,
  left,
  right,
  scrolled,
  large = true,
}: {
  title: string;
  /** Shown under a large title, and hidden with it once the page scrolls. */
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  scrolled: boolean;
  large?: boolean;
}) {
  return (
    <div className={`nav${scrolled || !large ? ' scrolled' : ''}`}>
      <div className="nav-inline">
        <div style={{ flex: '0 0 auto', minWidth: 44 }}>{left}</div>
        <div className="nav-title">{title}</div>
        <div style={{ flex: '0 0 auto', minWidth: 44, textAlign: 'right' }}>
          {right}
        </div>
      </div>
      {large && (
        <div className="nav-large">
          {title}
          {subtitle && <span className="nav-sub">{subtitle}</span>}
        </div>
      )}
    </div>
  );
}

export function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);
  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      setScrolled(e.currentTarget.scrollTop > threshold);
    },
    [threshold],
  );
  return { scrolled, onScroll };
}

export function BackButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="nav-btn" onClick={onClick}>
      <Icon name="chevron-left" size={21} strokeWidth={2.2} />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------- controls */

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  format,
}: {
  options: readonly T[];
  value: T;
  onChange: (v: T) => void;
  format?: (v: T) => string;
}) {
  return (
    <div className="segmented" role="group">
      {options.map((o) => (
        <button
          key={String(o)}
          aria-pressed={o === value}
          onClick={() => onChange(o)}
        >
          {format ? format(o) : String(o)}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      className="switch"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

/* ---------------------------------------------------------------- sheet */

export function Sheet({
  title,
  onClose,
  children,
  leftAction,
  rightAction,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
}) {
  // Escape closes, matching how a sheet behaves with a keyboard attached.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" />
        <div className="sheet-head">
          <div style={{ flex: '0 0 auto', minWidth: 60 }}>
            {leftAction ?? (
              <button className="nav-btn" onClick={onClose}>
                Cancel
              </button>
            )}
          </div>
          <h2>{title}</h2>
          <div style={{ flex: '0 0 auto', minWidth: 60, textAlign: 'right' }}>
            {rightAction}
          </div>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- swipe to delete */

/**
 * Flick a row leftwards to reveal Delete — the interaction the original app
 * advertised as "remove moments with the flick of a finger", and the one iOS
 * users expect from any list.
 *
 * Pointer events rather than touch events, so the same code path works for a
 * mouse in tests and a finger on the device.
 */
export function SwipeToDelete({
  children,
  onDelete,
  disabled,
}: {
  children: ReactNode;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startOffset = useRef(0);
  const captured = useRef(false);

  const WIDTH = 88;

  if (disabled) return <>{children}</>;

  return (
    <div className="swipe">
      <button
        className="swipe-action"
        onClick={() => {
          setOffset(0);
          onDelete();
        }}
        tabIndex={offset === 0 ? -1 : 0}
        aria-label="Delete"
      >
        <Icon name="trash" size={21} />
      </button>
      <div
        className={`swipe-content${dragging ? ' dragging' : ''}`}
        style={{ transform: `translateX(${-offset}px)` }}
        onPointerDown={(e) => {
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          startX.current = e.clientX;
          startOffset.current = offset;
          captured.current = false;
        }}
        onPointerMove={(e) => {
          if (!e.buttons && e.pointerType === 'mouse') return;
          const dx = startX.current - e.clientX;
          // Only take over once the gesture is clearly horizontal, otherwise
          // it would fight the list's vertical scrolling.
          if (!captured.current) {
            if (Math.abs(dx) < 10) return;
            captured.current = true;
            setDragging(true);
            e.currentTarget.setPointerCapture(e.pointerId);
          }
          const next = Math.max(0, Math.min(WIDTH * 1.4, startOffset.current + dx));
          setOffset(next);
        }}
        onPointerUp={() => {
          if (!captured.current) return;
          setDragging(false);
          captured.current = false;
          setOffset(offset > WIDTH * 0.5 ? WIDTH : 0);
        }}
        onPointerCancel={() => {
          setDragging(false);
          captured.current = false;
          setOffset(0);
        }}
      >
        {children}
      </div>
    </div>
  );
}
