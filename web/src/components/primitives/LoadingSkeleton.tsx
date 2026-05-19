/**
 * LoadingSkeleton - thin wrapper over Fluent UI's Skeleton primitives.
 *
 * Why wrap rather than use SkeletonItem directly: most of our list/
 * table loading states want N stacked rows of identical shape. Doing
 * that in every page means N+1 ad-hoc map() blocks; this primitive
 * lets the caller say `<LoadingSkeleton count={5} />` and stop
 * thinking about it.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C3
 */
import React from 'react';
import { Skeleton, SkeletonItem, makeStyles, tokens } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    width: '100%',
  },
  row: {
    display: 'block',
    backgroundColor: tokens.colorNeutralBackground3,
  },
});

export interface LoadingSkeletonProps {
  /** Number of stacked rows. Defaults to 1. */
  count?: number;
  /** Width of each row. Accepts any CSS length (default `100%`). */
  width?: string;
  /** Height of each row. Accepts any CSS length (default `16px`). */
  height?: string;
  /** Shape of each item. Default `rectangle`. */
  shape?: 'rectangle' | 'circle' | 'square';
  /** ARIA label for assistive tech. Default "Loading...". */
  ariaLabel?: string;
  /** Override the default test id. */
  'data-testid'?: string;
}

export const LoadingSkeleton: React.FC<LoadingSkeletonProps> = ({
  count = 1,
  width = '100%',
  height = '16px',
  shape = 'rectangle',
  ariaLabel = 'Loading...',
  ...rest
}) => {
  const classes = useStyles();
  const testId = rest['data-testid'] ?? 'loading-skeleton';
  // Floor + clamp so silly inputs (count=0, count=-3) don't crash and a
  // huge value doesn't accidentally explode the DOM.
  const rows = Math.min(Math.max(Math.floor(count), 1), 100);

  return (
    <Skeleton aria-label={ariaLabel} data-testid={testId} className={classes.root}>
      {Array.from({ length: rows }, (_, i) => (
        <SkeletonItem
          key={i}
          shape={shape}
          // Cast through unknown - SkeletonItem forwards style to the
          // animated div but the typing only exposes a subset.
          style={{ width, height } as React.CSSProperties}
          className={classes.row}
          data-testid={`${testId}-item`}
        />
      ))}
    </Skeleton>
  );
};
