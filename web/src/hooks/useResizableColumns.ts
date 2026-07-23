/**
 * useResizableColumns (X7) - drag-to-resize for hand-rolled `<table>` surfaces.
 *
 * The app's data grids are plain `<table>` elements with `table-layout: fixed`
 * (see the R5 table rules in the repo instructions). This hook adds mouse
 * drag-resize to their columns without pulling in a data-grid dependency:
 *
 *   const cols = useResizableColumns('logs', 7);
 *   <th {...cols.headerProps(0)}>Method<ColumnResizeHandle {...cols.handleProps(0)} /></th>
 *
 * - `headerProps(i)` sets the `<th>`'s pixel width (once the user has resized it)
 *   and `position: relative` so the handle can sit on its right edge.
 * - `handleProps(i)` wires a `<ColumnResizeHandle>` that, on drag, sets column
 *   `i`'s width to `max(minWidth, startWidth + dx)`.
 * - Widths persist to `localStorage` under `scimserver.colw.<key>` so a resize
 *   survives reloads. A `null` width means "use the stylesheet default" (the
 *   percentage widths stay until the user first drags that column).
 */
import * as React from 'react';

const MIN_WIDTH = 48;
const STORAGE_PREFIX = 'scimserver.colw.';

export interface ResizableColumnsApi {
  widths: Array<number | null>;
  headerProps: (index: number) => { style: React.CSSProperties };
  handleProps: (index: number) => {
    onMouseDown: (e: React.MouseEvent) => void;
    onDoubleClick: () => void;
    'data-testid'?: string;
  };
  /** Reset every column back to its stylesheet default. */
  reset: () => void;
}

function loadWidths(key: string, count: number): Array<number | null> {
  if (typeof window === 'undefined') return new Array(count).fill(null);
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + key);
    if (raw) {
      const parsed = JSON.parse(raw) as Array<number | null>;
      if (Array.isArray(parsed) && parsed.length === count) return parsed;
    }
  } catch {
    // ignore malformed storage
  }
  return new Array(count).fill(null);
}

export function useResizableColumns(key: string, count: number, testIdPrefix?: string): ResizableColumnsApi {
  const [widths, setWidths] = React.useState<Array<number | null>>(() => loadWidths(key, count));

  // Persist on change (best-effort; storage may be unavailable).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(widths));
    } catch {
      // ignore
    }
  }, [key, widths]);

  // Live drag state kept in a ref so the document listeners see fresh values.
  const drag = React.useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const onMouseMove = React.useCallback((e: MouseEvent) => {
    const d = drag.current;
    if (!d) return;
    const next = Math.max(MIN_WIDTH, d.startWidth + (e.clientX - d.startX));
    setWidths((prev) => {
      const copy = prev.slice();
      copy[d.index] = next;
      return copy;
    });
  }, []);

  const endDrag = React.useCallback(() => {
    drag.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', endDrag);
  }, [onMouseMove]);

  React.useEffect(() => endDrag, [endDrag]);

  const headerProps = React.useCallback(
    (index: number) => ({
      style: {
        position: 'relative' as const,
        ...(widths[index] != null ? { width: `${widths[index]}px` } : {}),
      },
    }),
    [widths],
  );

  const handleProps = React.useCallback(
    (index: number) => ({
      onMouseDown: (e: React.MouseEvent) => {
        // The <th> is the handle's offsetParent (position: relative).
        const th = (e.currentTarget as HTMLElement).parentElement;
        const startWidth = th ? th.getBoundingClientRect().width : MIN_WIDTH;
        drag.current = { index, startX: e.clientX, startWidth };
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', endDrag);
        e.preventDefault();
        e.stopPropagation();
      },
      // Double-click a handle to reset just that column to the default.
      onDoubleClick: () => {
        setWidths((prev) => {
          const copy = prev.slice();
          copy[index] = null;
          return copy;
        });
      },
      ...(testIdPrefix ? { 'data-testid': `${testIdPrefix}-resize-${index}` } : {}),
    }),
    [onMouseMove, endDrag, testIdPrefix],
  );

  const reset = React.useCallback(() => setWidths(new Array(count).fill(null)), [count]);

  return { widths, headerProps, handleProps, reset };
}
