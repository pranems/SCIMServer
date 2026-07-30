/**
 * DownloadJsonButton - one-click "download this thing as a .json file"
 * button. The download sibling of CopyJsonButton: where CopyJsonButton
 * puts the pretty-printed JSON on the clipboard, this saves it as a
 * file so the operator can attach the COMPLETE record to a ticket,
 * a regression fixture, or an offline diff.
 *
 * It serialises `value` via JSON.stringify(value, null, indent) and
 * triggers a browser download. It prefers a Blob + object URL (handles
 * large payloads) and falls back to a data: URI when object URLs are
 * unavailable (e.g. jsdom), so it never throws in a test environment.
 *
 * Testid: `<id>` is the button itself; tooltip + aria-label are derived
 * from the `label` prop ("Download JSON" by default).
 */
import * as React from 'react';
import { Button, Tooltip, makeStyles } from '@fluentui/react-components';
import {
  ArrowDownload16Regular,
  Checkmark16Regular,
  ErrorCircle16Regular,
} from '@fluentui/react-icons';

const useStyles = makeStyles({
  button: {
    minWidth: 'auto',
    height: '24px',
    padding: '0 8px',
    gap: '4px',
  },
});

export interface DownloadJsonButtonProps {
  /** The object/value to serialise + download. Anything JSON.stringify can handle. */
  value: unknown;
  /** Indent spaces. Default 2 (matches the rest of our pretty-printed JSON). */
  indent?: number;
  /**
   * Download file name (without extension). Default "export". A `.json`
   * suffix is appended if not already present.
   */
  filename?: string;
  /** Button label - rendered inline next to the icon. Default "Download JSON". */
  label?: string;
  /** Optional `data-testid`; used directly on the button. */
  'data-testid'?: string;
  /** Accessible label override. Defaults to `label`. */
  ariaLabel?: string;
  /** Tooltip placement; default "above". */
  tooltipPlacement?: 'above' | 'below' | 'before' | 'after';
  /** Button appearance; default "subtle". */
  appearance?: 'subtle' | 'outline' | 'primary' | 'transparent' | 'secondary';
  /** Hide the inline text label and render icon-only (use ariaLabel for a11y). */
  iconOnly?: boolean;
}

/** Ensure the filename ends in `.json` and is filesystem-safe (case preserved). */
function toJsonFilename(name: string): string {
  const base = (name || 'export').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'export';
  return /\.json$/i.test(base) ? base : `${base}.json`;
}

export const DownloadJsonButton: React.FC<DownloadJsonButtonProps> = ({
  value,
  indent = 2,
  filename = 'export',
  label = 'Download JSON',
  'data-testid': testId,
  ariaLabel,
  tooltipPlacement = 'above',
  appearance = 'subtle',
  iconOnly = false,
}) => {
  const classes = useStyles();
  const [status, setStatus] = React.useState<'idle' | 'done' | 'error'>('idle');
  const resetTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  const flash = (next: 'done' | 'error'): void => {
    setStatus(next);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setStatus('idle'), 1500);
  };

  const onClick = (e: React.MouseEvent): void => {
    e.stopPropagation();
    let payload: string;
    try {
      payload = JSON.stringify(value, null, indent) ?? 'null';
    } catch {
      payload = String(value);
    }

    try {
      const name = toJsonFilename(filename);
      const anchor = document.createElement('a');
      let objectUrl: string | undefined;

      const canBlob =
        typeof Blob !== 'undefined' &&
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function';

      if (canBlob) {
        const blob = new Blob([payload], { type: 'application/json' });
        objectUrl = URL.createObjectURL(blob);
        anchor.href = objectUrl;
      } else {
        anchor.href = `data:application/json;charset=utf-8,${encodeURIComponent(payload)}`;
      }

      anchor.download = name;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      if (objectUrl && typeof URL.revokeObjectURL === 'function') {
        URL.revokeObjectURL(objectUrl);
      }
      flash('done');
    } catch {
      flash('error');
    }
  };

  const tooltipContent =
    status === 'done' ? 'Downloaded!' : status === 'error' ? 'Download failed' : label;

  const icon =
    status === 'done' ? (
      <Checkmark16Regular />
    ) : status === 'error' ? (
      <ErrorCircle16Regular />
    ) : (
      <ArrowDownload16Regular />
    );

  return (
    <Tooltip content={tooltipContent} relationship="label" positioning={tooltipPlacement}>
      <Button
        appearance={appearance}
        icon={icon}
        size="small"
        className={classes.button}
        onClick={onClick}
        data-testid={testId}
        aria-label={ariaLabel ?? label}
      >
        {iconOnly ? undefined : label}
      </Button>
    </Tooltip>
  );
};
