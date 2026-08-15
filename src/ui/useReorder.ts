import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-to-reorder built on pointer events.
 *
 * Three earlier versions were wrong in instructive ways:
 *
 *  1. HTML5 drag-and-drop, which never fires for touch on iOS. It worked in a
 *     desktop browser and was silently dead on the target device.
 *  2. The reorder call lived inside a React state updater, which must be pure.
 *     React can double-invoke or discard it, and it did nothing.
 *  3. Move and end were handled on the dragged element itself. Hit-testing
 *     needs that element to be transparent to `elementFromPoint`, so it gets
 *     `pointer-events: none` — which also stopped it receiving the pointerup
 *     that ends the drag, leaving the item stuck mid-air over its neighbours.
 *
 * So the drag is tracked on `window` for its duration. Nothing depends on the
 * dragged element staying interactive, and the gesture survives the pointer
 * leaving the element, the list, or the viewport.
 *
 * Position comes from hit-testing what is under the pointer rather than from
 * distance maths, which works for a list and a grid alike and copes with rows
 * of differing heights.
 */
export interface ReorderVisual {
  draggingId: string | null;
  offsetX: number;
  offsetY: number;
}

const EDGE = 72;
const MAX_SCROLL_STEP = 14;

export function useReorder(
  order: string[],
  onReorder: (next: string[]) => void,
  onCommit: (next: string[]) => void,
) {
  const [visual, setVisual] = useState<ReorderVisual>({
    draggingId: null,
    offsetX: 0,
    offsetY: 0,
  });

  const dragging = useRef<string | null>(null);
  const start = useRef({ x: 0, y: 0 });
  const pointer = useRef({ x: 0, y: 0 });
  const orderRef = useRef(order);
  const scroller = useRef<HTMLElement | null>(null);
  const raf = useRef(0);
  orderRef.current = order;

  /** Move the dragged id to whatever it is currently hovering over. */
  const hitTest = useCallback(() => {
    const id = dragging.current;
    if (!id) return;

    const el = document
      .elementFromPoint(pointer.current.x, pointer.current.y)
      ?.closest('[data-moment-id]') as HTMLElement | null;
    const overId = el?.dataset.momentId;
    if (!overId || overId === id) return;

    const current = orderRef.current;
    const from = current.indexOf(id);
    const to = current.indexOf(overId);
    if (from === -1 || to === -1) return;

    const next = [...current];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    orderRef.current = next;
    onReorder(next);
  }, [onReorder]);

  /**
   * Scroll when the pointer nears an edge. Without it, moving a moment from
   * position 50 to position 3 means dragging into a wall.
   */
  const tick = useCallback(() => {
    const box = scroller.current;
    if (!box || !dragging.current) return;

    const r = box.getBoundingClientRect();
    const y = pointer.current.y;
    let delta = 0;
    if (y < r.top + EDGE) {
      delta = -Math.ceil(((r.top + EDGE - y) / EDGE) * MAX_SCROLL_STEP);
    } else if (y > r.bottom - EDGE) {
      delta = Math.ceil(((y - (r.bottom - EDGE)) / EDGE) * MAX_SCROLL_STEP);
    }

    if (delta) {
      box.scrollTop += delta;
      hitTest();
    }
    raf.current = requestAnimationFrame(tick);
  }, [hitTest]);

  const finish = useRef(() => {});

  const begin = useCallback(
    (id: string, el: HTMLElement, _pointerId: number, x: number, y: number) => {
      scroller.current = el.closest('.scroll') as HTMLElement | null;
      dragging.current = id;
      start.current = { x, y };
      pointer.current = { x, y };
      setVisual({ draggingId: id, offsetX: 0, offsetY: 0 });

      const onMove = (e: PointerEvent) => {
        if (!dragging.current) return;
        e.preventDefault();
        pointer.current = { x: e.clientX, y: e.clientY };
        setVisual({
          draggingId: dragging.current,
          offsetX: e.clientX - start.current.x,
          offsetY: e.clientY - start.current.y,
        });
        hitTest();
      };

      const onUp = () => {
        finish.current();
      };

      finish.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        if (raf.current) cancelAnimationFrame(raf.current);
        raf.current = 0;
        if (dragging.current) onCommit(orderRef.current);
        dragging.current = null;
        finish.current = () => {};
        setVisual({ draggingId: null, offsetX: 0, offsetY: 0 });
      };

      // passive: false so preventDefault can stop the page scrolling under a
      // finger that is dragging a moment.
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
      raf.current = requestAnimationFrame(tick);
    },
    [hitTest, onCommit, tick],
  );

  // A drag interrupted by unmounting must not leave listeners behind.
  useEffect(() => () => finish.current(), []);

  return { state: visual, begin };
}
