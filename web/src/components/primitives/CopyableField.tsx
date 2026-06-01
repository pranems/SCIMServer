/**
 * CopyableField - inline display of a string value paired with a
 * one-click copy-to-clipboard button. Centralises the visual + UX
 * pattern that was previously hand-rolled in CredentialsTab (the
 * one-shot bearer token box) + SchemasTab (the "Copy URN" button on
 * each schema row) + DiscoveryExplorerPage (the Copy-as-JSON /
 * Copy-as-URN action toolbar).
 *
 * Composes:
 *   - useCopyToClipboard for the success / error / auto-reset state machine
 *   - TruncatedText (optional) for long values that should clip + reveal on hover
 *
 * The button is always reachable via keyboard (focusable Fluent
 * Button) and tagged with a stable testid pattern
 * `<data-testid>-copy-button` so Playwright specs can assert the copy
 * affordance per surface without coupling to text labels.
 */
import * as React from 'react';
import { Button, Tooltip, makeStyles, tokens, mergeClasses } from '@fluentui/react-components';
import { Copy16Regular, Checkmark16Regular, ErrorCircle16Regular } from '@fluentui/react-icons';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { TruncatedText } from './TruncatedText';

const useStyles = makeStyles({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    minWidth: 0,
    maxWidth: '100%',
  },
  value: {
    minWidth: 0,
    flex: '1 1 auto',
  },
  monospace: {
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
  },
  button: {
    flex: '0 0 auto',
    minWidth: '24px',
    height: '24px',
    padding: 0,
  },
});

export interface CopyableFieldProps {
  /** The string value to display + copy. */
  value: string;
  /**
   * Optional override - when set, the COPIED value is `copyValue` while
   * the DISPLAYED value is `value`. Useful when the on-screen text is
   * truncated/formatted but the clipboard payload should be the full
   * raw value.
   */
  copyValue?: string;
  /** Show the value in a monospace font (IDs, URNs, paths). */
  monospace?: boolean;
  /** Truncate the displayed value with ellipsis + Tooltip on overflow. */
  truncate?: boolean;
  /** Optional max width for the value cell when truncating. */
  maxWidth?: string | number;
  /** Optional `data-testid` for spec selection. The button gets `<id>-copy-button`. */
  'data-testid'?: string;
  /** Optional className for the container. */
  className?: string;
  /**
   * When true, render only the button (no inline value text). Use this
   * pattern when the value is rendered separately and you want a copy
   * affordance attached to it (e.g. inside a custom table cell).
   */
  buttonOnly?: boolean;
  /** Accessible label for the copy button; defaults to `Copy "<value>"`. */
  ariaLabel?: string;
}

export const CopyableField: React.FC<CopyableFieldProps> = ({
  value,
  copyValue,
  monospace = false,
  truncate = false,
  maxWidth,
  buttonOnly = false,
  ariaLabel,
  className,
  'data-testid': testId,
}) => {
  const classes = useStyles();
  const { copy, status } = useCopyToClipboard();

  const payload = copyValue ?? value;
  const buttonTestId = testId ? `${testId}-copy-button` : undefined;
  const tooltipContent =
    status === 'copied' ? 'Copied!' : status === 'error' ? 'Failed to copy' : 'Copy to clipboard';

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void copy(payload);
  };

  const icon =
    status === 'copied' ? (
      <Checkmark16Regular />
    ) : status === 'error' ? (
      <ErrorCircle16Regular />
    ) : (
      <Copy16Regular />
    );

  return (
    <span className={mergeClasses(classes.root, className)} data-testid={testId}>
      {!buttonOnly && (
        <span className={mergeClasses(classes.value, monospace ? classes.monospace : undefined)}>
          {truncate ? (
            <TruncatedText text={value} monospace={monospace} maxWidth={maxWidth} />
          ) : (
            value
          )}
        </span>
      )}
      <Tooltip content={tooltipContent} relationship="label" positioning="above">
        <Button
          appearance="subtle"
          icon={icon}
          size="small"
          className={classes.button}
          onClick={onClick}
          data-testid={buttonTestId}
          aria-label={ariaLabel ?? `Copy ${value}`}
        />
      </Tooltip>
    </span>
  );
};
