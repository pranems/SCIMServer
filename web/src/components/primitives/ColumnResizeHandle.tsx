/**
 * ColumnResizeHandle (X7) - the thin, draggable grip a resizable `<table>`
 * column header renders on its right edge. Pair it with `useResizableColumns`:
 *
 *   <th {...cols.headerProps(0)}>Method<ColumnResizeHandle {...cols.handleProps(0)} /></th>
 *
 * It is absolutely positioned inside a `position: relative` `<th>`, sits on the
 * cell's right border, shows a `col-resize` cursor, and widens/highlights on
 * hover so it reads as an interactive affordance (X1 clickable-affordance norm).
 * It is keyboard/pointer-only for drag; a double-click resets the column.
 */
import * as React from 'react';
import { makeStyles, tokens, mergeClasses } from '@fluentui/react-components';

const useStyles = makeStyles({
  handle: {
    position: 'absolute',
    top: 0,
    right: '-3px',
    width: '7px',
    height: '100%',
    cursor: 'col-resize',
    userSelect: 'none',
    zIndex: 1,
    // A subtle centered divider that thickens + tints on hover so the grip is
    // discoverable as a draggable affordance.
    ':hover': {
      backgroundColor: tokens.colorNeutralStroke1Hover,
    },
    ':after': {
      content: '""',
      position: 'absolute',
      top: '20%',
      right: '3px',
      width: '1px',
      height: '60%',
      backgroundColor: tokens.colorNeutralStroke2,
    },
  },
});

export interface ColumnResizeHandleProps {
  onMouseDown: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  'data-testid'?: string;
}

export const ColumnResizeHandle: React.FC<ColumnResizeHandleProps> = ({
  onMouseDown,
  onDoubleClick,
  'data-testid': dataTestId,
}) => {
  const classes = useStyles();
  return (
    <span
      className={mergeClasses(classes.handle)}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize column"
      onMouseDown={onMouseDown}
      onDoubleClick={onDoubleClick}
      // Clicking the grip must never trigger the header's own click/sort.
      onClick={(e) => e.stopPropagation()}
      data-testid={dataTestId}
    />
  );
};
