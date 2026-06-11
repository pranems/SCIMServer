/**
 * CopyableJsonBlock - read-only pretty-printed JSON viewer with a
 * built-in "Copy as JSON" button in the header. The canonical
 * affordance for surfaces that previously rendered
 * `<pre>{JSON.stringify(x, null, 2)}</pre>` without any copy
 * affordance (ResourceDetailDrawer additional attributes,
 * ManualProvision result, LogsPage detail body, BulkTab preview,
 * Workbench response, etc.).
 *
 * The block enforces R5-style overflow safety - long tokens break,
 * the inner pre never pushes its container horizontally, and a
 * vertical scrollbar appears past `maxHeight` (default 320px).
 *
 * Composes:
 *   - CopyJsonButton (header right corner)
 *   - Fluent UI tokens for theme-aware monospace block styling
 */
import * as React from 'react';
import { makeStyles, tokens } from '@fluentui/react-components';
import { CopyJsonButton } from './CopyJsonButton';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
    maxWidth: '100%',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  label: {
    color: tokens.colorNeutralForeground3,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
    wordBreak: 'break-all',
    minWidth: 0,
  },
  pre: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground2,
    padding: '6px 8px',
    borderRadius: tokens.borderRadiusSmall,
    margin: 0,
    // R5 overflow safety - long unbreakable tokens (URLs/URNs) must
    // not push the <pre> past its container, otherwise the parent
    // surface starts horizontal-scrolling.
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    overflowWrap: 'anywhere',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
  },
});

export interface CopyableJsonBlockProps {
  /** The value to render + copy. Anything JSON.stringify can handle. */
  value: unknown;
  /** Optional label shown on the left of the header (e.g. attribute name). */
  label?: React.ReactNode;
  /** Pretty-print indent; default 2. */
  indent?: number;
  /** Max height before vertical scroll kicks in; default "320px". */
  maxHeight?: string;
  /** Optional `data-testid`; the copy button gets `<id>-copy-button`. */
  'data-testid'?: string;
  /** Button label override; default "Copy as JSON". */
  copyButtonLabel?: string;
}

export const CopyableJsonBlock: React.FC<CopyableJsonBlockProps> = ({
  value,
  label,
  indent = 2,
  maxHeight = '320px',
  'data-testid': testId,
  copyButtonLabel = 'Copy as JSON',
}) => {
  const classes = useStyles();
  const text = React.useMemo(() => {
    try {
      return JSON.stringify(value, null, indent) ?? 'null';
    } catch {
      return String(value);
    }
  }, [value, indent]);

  return (
    <div className={classes.root} data-testid={testId}>
      {(label !== undefined || true) && (
        <div className={classes.header}>
          {label !== undefined ? (
            <span className={classes.label}>{label}</span>
          ) : (
            <span />
          )}
          <CopyJsonButton
            value={value}
            indent={indent}
            label={copyButtonLabel}
            data-testid={testId ? `${testId}-copy-button` : undefined}
            iconOnly
            ariaLabel={copyButtonLabel}
          />
        </div>
      )}
      <pre
        className={classes.pre}
        // eslint-disable-next-line react/forbid-dom-props -- maxHeight is a per-instance prop, not a static style
        style={{ maxHeight }}
        data-testid={testId ? `${testId}-pre` : undefined}
      >
        {text}
      </pre>
    </div>
  );
};
