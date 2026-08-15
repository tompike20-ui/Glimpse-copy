import { useCallback, useRef, useState } from 'react';

/**
 * Drag-to-reorder built on pointer events.
 *
 * The previous implementation used the HTML5 drag-and-drop API, which does not
 * fire at all for touch input on iOS — reordering worked in a desktop browser
 * and was silently dead on the device the app is actually for. Pointer events
 * cover mouse and touch with one code path.
 *
 * Drag bookkeeping lives in refs rather than state, because reordering is a
 * side effect and React state updaters must stay pure — doing it inside an
 * updater lets React double-invoke or drop the reorder entirely.
 *
 * The list is reordered live as the drag passes each neighbour, so the row
 * under the finger is always in its would-be final position.
 */
export interface ReorderVisual {
  draggingId: string | null;
  offsetY: number;
}

export function useReorder(
  order: string[],
  onReorder: (next: string[]) => void,
  onCommit: (next: string[]) => void,
) {
  const [visual, setVisual] = useState<ReorderVisual>({
    draggingId: null,
    offsetY: 0,
  });

  const dragging = useRef<string | null>(null);
  const startY = useRef(0);
  const rowH = useRef(64);
  const orderRef = useRef(order);
  orderRef.current = order;

  const begin = useCallback((id: string, e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    rowH.current = el.closest('li')?.getBoundingClientRect().height || 64;
    dragging.current = id;
    startY.current = e.clientY;
    setVisual({ draggingId: id, offsetY: 0 });
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const move = useCallback(
    (e: React.PointerEvent) => {
      const id = dragging.current;
      if (!id) return;

      const dy = e.clientY - startY.current;
      const current = orderRef.current;
      const index = current.indexOf(id);
      if (index === -1) return;

      const step = rowH.current || 64;
      const steps = Math.round(dy / step);
      const target = Math.max(0, Math.min(current.length - 1, index + steps));

      if (target !== index) {
        const next = [...current];
        const [item] = next.splice(index, 1);
        next.splice(target, 0, item);
        orderRef.current = next;
        onReorder(next);
        // Re-anchor so the row keeps tracking the finger after the swap.
        startY.current += (target - index) * step;
        setVisual({ draggingId: id, offsetY: e.clientY - startY.current });
      } else {
        setVisual({ draggingId: id, offsetY: dy });
      }
    },
    [onReorder],
  );

  const end = useCallback(() => {
    if (dragging.current) onCommit(orderRef.current);
    dragging.current = null;
    setVisual({ draggingId: null, offsetY: 0 });
  }, [onCommit]);

  return { state: visual, begin, move, end };
}
