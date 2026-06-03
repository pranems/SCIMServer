/**
 * EditableField - Fluent UI `<Input>` or `<Textarea>` wrapper that
 * adds three first-class affordances every editable field in the app
 * should carry:
 *
 *   1. Copy: copy the CURRENT value to the clipboard (whether the
 *      operator has typed changes or not). Same icon + state machine
 *      as CopyableField so the UX feels uniform.
 *
 *   2. Reset to original: revert to the value the field was seeded
 *      with on mount / on prop change. Only enabled when the current
 *      value differs from the original. Distinct from "undo last
 *      keystroke" - this is a single "back to where we started"
 *      action that is invaluable when the operator has made many
 *      small edits and wants out.
 *
 *   3. Undo / redo: a small history stack of the value over time so
 *      Ctrl+Z-style undo works even when the operator's last edit
 *      was a paste / clear / programmatic change (which the browser
 *      may not include in its native undo history).
 *
 * Standard input + textarea still respond to native Ctrl+Z within
 * a single keystroke session. EditableField's undo/redo buttons
 * cover the cases where native fails (paste, programmatic reset,
 * focus-loss + return).
 *
 * Composition:
 *   - Fluent UI `<Input>` (single line) or `<Textarea>` (multi-line,
 *     via the `multiline` prop)
 *   - useCopyToClipboard for the copy affordance
 *   - Internal history stack capped at 50 entries
 *
 * Testid pattern:
 *   - root container: `<data-testid>`
 *   - input/textarea: `<data-testid>-input`
 *   - copy button: `<data-testid>-copy-button`
 *   - reset button: `<data-testid>-reset-button`
 *   - undo button: `<data-testid>-undo-button`
 *   - redo button: `<data-testid>-redo-button`
 */
import * as React from 'react';
import {
  Input,
  Textarea,
  Button,
  Tooltip,
  makeStyles,
  tokens,
  Field,
} from '@fluentui/react-components';
import {
  Copy16Regular,
  Checkmark16Regular,
  ErrorCircle16Regular,
  ArrowReset20Regular,
  ArrowUndo16Regular,
  ArrowRedo16Regular,
} from '@fluentui/react-icons';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    minWidth: 0,
    maxWidth: '100%',
  },
  inputRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '4px',
    minWidth: 0,
    maxWidth: '100%',
  },
  inputCell: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  buttons: {
    display: 'inline-flex',
    flex: '0 0 auto',
    gap: '2px',
    alignItems: 'center',
  },
  button: {
    minWidth: '24px',
    height: '24px',
    padding: 0,
  },
  hint: {
    color: tokens.colorNeutralForeground3,
    fontSize: '11px',
    fontFamily: 'Consolas, "Courier New", monospace',
  },
});

export interface EditableFieldProps {
  /** Field label rendered above the input (via Fluent `Field`). */
  label: string;
  /** Current value (controlled). */
  value: string;
  /** Value-change handler. */
  onChange: (next: string) => void;
  /** Render as <Textarea> instead of <Input>. */
  multiline?: boolean;
  /** Number of rows when multiline. Default 3. */
  rows?: number;
  /** Optional placeholder text. */
  placeholder?: string;
  /** Disable the input + all buttons. */
  disabled?: boolean;
  /** Optional `data-testid`. */
  'data-testid'?: string;
  /** Render in monospace (IDs, URNs, paths). */
  monospace?: boolean;
  /** Hide the inline "buttons" affordance row (rarely useful). */
  hideButtons?: boolean;
}

const HISTORY_CAP = 50;

export const EditableField: React.FC<EditableFieldProps> = ({
  label,
  value,
  onChange,
  multiline = false,
  rows = 3,
  placeholder,
  disabled = false,
  'data-testid': testId,
  monospace = false,
  hideButtons = false,
}) => {
  const classes = useStyles();
  const { copy, status } = useCopyToClipboard();

  // Track the value the field was seeded with (or last reset to).
  // Refresh whenever the controlled value changes via a route that
  // is NOT this component's onChange - e.g. parent re-fetches the
  // resource. We detect "external change" by comparing the incoming
  // value to BOTH original and the last-recorded history tail.
  const originalRef = React.useRef<string>(value);
  const [history, setHistory] = React.useState<string[]>([value]);
  const [cursor, setCursor] = React.useState(0);

  React.useEffect(() => {
    // External re-seed: parent fetched a fresh resource and the value
    // changed without going through our onChange. Reset history.
    const currentTail = history[cursor];
    if (value !== currentTail) {
      originalRef.current = value;
      setHistory([value]);
      setCursor(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const pushHistory = (next: string): void => {
    setHistory((prev) => {
      // Drop any redo tail when a new edit lands.
      const trimmed = prev.slice(0, cursor + 1);
      trimmed.push(next);
      // Cap the stack so a long editing session does not balloon memory.
      const overflow = trimmed.length - HISTORY_CAP;
      return overflow > 0 ? trimmed.slice(overflow) : trimmed;
    });
    setCursor((c) => Math.min(c + 1, HISTORY_CAP - 1));
  };

  const handleChange = (next: string): void => {
    pushHistory(next);
    onChange(next);
  };

  const handleCopy = (e: React.MouseEvent): void => {
    e.stopPropagation();
    void copy(value);
  };

  const handleReset = (e: React.MouseEvent): void => {
    e.stopPropagation();
    pushHistory(originalRef.current);
    onChange(originalRef.current);
  };

  const handleUndo = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (cursor > 0) {
      const next = history[cursor - 1];
      setCursor(cursor - 1);
      onChange(next);
    }
  };

  const handleRedo = (e: React.MouseEvent): void => {
    e.stopPropagation();
    if (cursor < history.length - 1) {
      const next = history[cursor + 1];
      setCursor(cursor + 1);
      onChange(next);
    }
  };

  const canUndo = cursor > 0;
  const canRedo = cursor < history.length - 1;
  const canReset = value !== originalRef.current;
  const copyIcon =
    status === 'copied' ? (
      <Checkmark16Regular />
    ) : status === 'error' ? (
      <ErrorCircle16Regular />
    ) : (
      <Copy16Regular />
    );
  const copyTooltip = status === 'copied' ? 'Copied!' : status === 'error' ? 'Failed to copy' : 'Copy to clipboard';

  const inputTestId = testId ? `${testId}-input` : undefined;
  const fieldContents = multiline ? (
    <Textarea
      value={value}
      onChange={(_, d) => handleChange(d.value)}
      placeholder={placeholder}
      disabled={disabled}
      rows={rows}
      data-testid={inputTestId}
      style={monospace ? { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '12px' } : undefined}
    />
  ) : (
    <Input
      value={value}
      onChange={(_, d) => handleChange(d.value)}
      placeholder={placeholder}
      disabled={disabled}
      data-testid={inputTestId}
      style={monospace ? { fontFamily: 'Consolas, "Courier New", monospace', fontSize: '12px' } : undefined}
    />
  );

  return (
    <Field label={label} className={classes.root} data-testid={testId}>
      <div className={classes.inputRow}>
        <div className={classes.inputCell}>{fieldContents}</div>
        {!hideButtons && (
          <div className={classes.buttons}>
            <Tooltip content={copyTooltip} relationship="label" positioning="above">
              <Button
                appearance="subtle"
                size="small"
                icon={copyIcon}
                className={classes.button}
                onClick={handleCopy}
                aria-label="Copy field value"
                data-testid={testId ? `${testId}-copy-button` : undefined}
              />
            </Tooltip>
            <Tooltip content="Undo" relationship="label" positioning="above">
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowUndo16Regular />}
                className={classes.button}
                onClick={handleUndo}
                disabled={disabled || !canUndo}
                aria-label="Undo"
                data-testid={testId ? `${testId}-undo-button` : undefined}
              />
            </Tooltip>
            <Tooltip content="Redo" relationship="label" positioning="above">
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowRedo16Regular />}
                className={classes.button}
                onClick={handleRedo}
                disabled={disabled || !canRedo}
                aria-label="Redo"
                data-testid={testId ? `${testId}-redo-button` : undefined}
              />
            </Tooltip>
            <Tooltip content="Reset to original" relationship="label" positioning="above">
              <Button
                appearance="subtle"
                size="small"
                icon={<ArrowReset20Regular />}
                className={classes.button}
                onClick={handleReset}
                disabled={disabled || !canReset}
                aria-label="Reset to original value"
                data-testid={testId ? `${testId}-reset-button` : undefined}
              />
            </Tooltip>
          </div>
        )}
      </div>
    </Field>
  );
};
