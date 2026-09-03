import { useEffect, useState } from 'react';
import { trimmedDurationMs, type Moment } from '../types';
import { getBlob } from '../storage/db';
import { Icon } from './Icon';
import { Sheet } from './components';
import { isNoop, organise, ORGANISE_MODES, type OrganiseMode } from './organise';

/**
 * Bulk reordering. Dragging one moment at a time is fine for a nudge and
 * hopeless for a forty-moment Glimpse, which is where this comes in.
 *
 * The chosen order is previewed before it is applied, because a shuffle you
 * cannot see before committing to is a gamble rather than a choice. Nothing is
 * written until Apply, and Apply is undoable.
 */
export function OrganiseSheet({
  order,
  moments,
  onCancel,
  onApply,
}: {
  order: string[];
  moments: Record<string, Moment>;
  onCancel: () => void;
  onApply: (next: string[]) => void;
}) {
  const [mode, setMode] = useState<OrganiseMode | null>(null);
  const [next, setNext] = useState<string[]>(order);

  const pick = (m: OrganiseMode) => {
    setMode(m);
    // Tapping Shuffle again reshuffles, which is what "reshuffles each tap"
    // promises and the only way to reject an order you dislike.
    setNext(organise(order, moments, m));
  };

  const unchanged = isNoop(order, next);
  const shown = next
    .map((mid) => moments[mid])
    .filter((m): m is Moment => !!m);
  const totalMs = shown.reduce((s, m) => s + trimmedDurationMs(m), 0);

  return (
    <Sheet
      title="Organise"
      onClose={onCancel}
      rightAction={
        <button
          className="nav-btn right"
          style={{ fontWeight: 600 }}
          disabled={!mode || unchanged}
          onClick={() => onApply(next)}
        >
          Apply
        </button>
      }
    >
      <div className="organise-preview">
        <div className="organise-strip">
          {shown.slice(0, 5).map((m) => (
            <OrderTile key={m.id} moment={m} />
          ))}
        </div>
        <div className="organise-caption">
          {mode ? 'New order' : 'Current order'} · {shown.length} moment
          {shown.length === 1 ? '' : 's'} · {(totalMs / 1000).toFixed(1)}s
          {shown.length > 5 && ` · showing first 5`}
        </div>
      </div>

      <div className="group">
        <div className="group-header">Order by</div>
        <div className="list">
          {ORGANISE_MODES.map((opt) => (
            <button
              key={opt.mode}
              className="row organise-row"
              aria-pressed={mode === opt.mode}
              onClick={() => pick(opt.mode)}
            >
              <span className={`organise-icon${mode === opt.mode ? ' on' : ''}`}>
                <Icon name={opt.icon} size={21} />
              </span>
              <span className="row-main">
                <span className="row-title">{opt.title}</span>
                <span className="row-sub">{opt.sub}</span>
              </span>
              {mode === opt.mode && (
                <span className="organise-check">
                  <Icon name="check" size={20} strokeWidth={2.6} />
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="group-footer">
          {mode && unchanged
            ? 'That is already the order these moments are in.'
            : 'Nothing changes until you tap Apply, and Apply can be undone.'}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * A poster frame, not a playing clip: five decoding players inside a sheet is
 * a lot of work for a thumbnail, and the first frame is enough to recognise a
 * moment by.
 */
function OrderTile({ moment }: { moment: Moment }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let made: string | null = null;
    let cancelled = false;
    void getBlob(moment.blobKey).then((b) => {
      if (!b || cancelled) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      cancelled = true;
      if (made) URL.revokeObjectURL(made);
    };
  }, [moment.blobKey]);

  return (
    <div className="organise-tile" aria-hidden="true">
      {!url ? (
        <span className="tile-ph" />
      ) : moment.kind === 'still' ? (
        <img src={url} alt="" />
      ) : (
        <video src={url} muted playsInline preload="metadata" />
      )}
    </div>
  );
}
