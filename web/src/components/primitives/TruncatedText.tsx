/**
 * TruncatedText - small primitive that renders a string with CSS
 * ellipsis when it overflows the parent's width, and surfaces the
 * full text via a Fluent Tooltip on hover/focus.
 *
 * Purpose: the SCIMServer admin UI surfaces many user-controlled long
 * strings (email-shaped userNames like
 * `2022-12-0888c929dba3164c50b89efa0a1ee4faf8103198@proviamtest.onmicrosoft.com`,
 * 80-character schema URNs, 36-character resource IDs) that overflow
 * table cells + detail-drawer fields with no truncation strategy.
 * This primitive standardises the visual treatment: clip with `...`,
 * preserve a stable column width, and let the operator read or copy
 * the full value via the hover tooltip without re-flowing the table.
 *
 * Truncation is CSS-driven (overflow:hidden + textOverflow:ellipsis +
 * whiteSpace:nowrap) so it adapts to any container width without
 * JavaScript measurement. The tooltip is mounted unconditionally so
 * keyboard users can reach it via focus even when truncation isn't
 * visually triggered.
 *
 * @see web/src/components/primitives/CopyableField.tsx for a related
 * pattern that pairs truncation with a copy-to-clipboard affordance.
 */
import * as React from 'react';
import { Tooltip, makeStyles, tokens, mergeClasses } from '@fluentui/react-components';

const useStyles = makeStyles({
  root: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    minWidth: 0,
  },
  monospace: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
});

export interface TruncatedTextProps {
  /** The full text to display + reveal on hover. */
  text: string;
  /** Optional className for the container (e.g. monospace + tokens). */
  className?: string;
  /** Render in a monospace font (matches existing schema URN + id styling). */
  monospace?: boolean;
  /** Optional max width override; defaults to filling the parent column. */
  maxWidth?: string | number;
  /** Optional `data-testid` for spec selection. */
  'data-testid'?: string;
  /**
   * Tooltip placement; defaults to 'above'. Use 'below' for header rows
   * where the cell is already at the top of the viewport.
   */
  tooltipPlacement?: 'above' | 'below' | 'before' | 'after';
}

export const TruncatedText: React.FC<TruncatedTextProps> = ({
  text,
  className,
  monospace = false,
  maxWidth,
  tooltipPlacement = 'above',
  'data-testid': testId,
}) => {
  const classes = useStyles();
  const style: React.CSSProperties = maxWidth !== undefined ? { maxWidth } : {};
  const mergedClass = mergeClasses(classes.root, monospace ? classes.monospace : undefined, className);

  return (
    <Tooltip content={text} relationship="label" positioning={tooltipPlacement}>
      <span className={mergedClass} style={style} data-testid={testId}>
        {text}
      </span>
    </Tooltip>
  );
};
