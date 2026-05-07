/**
 * FormDialog - modal dialog wrapping a `<form>`. Manages Submit /
 * Cancel buttons, busy state, and optional error banner so callers
 * just supply their fields.
 *
 * Used by Phase E features (create/update credential, manual provision,
 * config flag toggles) so each one doesn't reimplement the
 * Dialog-with-buttons wiring.
 *
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase C2
 */
import React from 'react';
import {
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Spinner,
  makeStyles,
  tokens,
} from '@fluentui/react-components';

const useStyles = makeStyles({
  errorBanner: {
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    padding: '8px 12px',
    borderRadius: tokens.borderRadiusMedium,
    marginBottom: '12px',
  },
  fields: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  busyHint: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: tokens.colorNeutralForeground3,
  },
});

export interface FormDialogProps {
  /** Whether the dialog is open. Controlled externally. */
  open: boolean;
  /** Called when the user cancels (X, backdrop, ESC, Cancel button). */
  onCancel: () => void;
  /** Called when the user clicks Submit. Should perform the mutation. */
  onSubmit: () => void;
  /** Title of the dialog. */
  title: string;
  /** Form fields - rendered inside a flex column with spacing. */
  children: React.ReactNode;
  /** Submit button label. Default "Save". */
  submitLabel?: string;
  /** Cancel button label. Default "Cancel". */
  cancelLabel?: string;
  /** When true, disables both buttons and shows a spinner. */
  busy?: boolean;
  /** When set, renders a red error banner above the fields. */
  errorMessage?: string | null;
  /** When true, the submit button is disabled (e.g. invalid form). */
  disabled?: boolean;
  /** Override the default test id. */
  'data-testid'?: string;
}

export const FormDialog: React.FC<FormDialogProps> = ({
  open,
  onCancel,
  onSubmit,
  title,
  children,
  submitLabel = 'Save',
  cancelLabel = 'Cancel',
  busy = false,
  errorMessage,
  disabled = false,
  ...rest
}) => {
  const classes = useStyles();
  const testId = rest['data-testid'] ?? 'form-dialog';

  // Prevent the user from re-clicking Submit while a previous submission
  // is in flight. Disabling alone catches mouse clicks, but we also
  // intercept the form's onSubmit (Enter key) for the same reason.
  const handleFormSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    if (busy || disabled) return;
    onSubmit();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(_, data) => {
        // Don't let a click outside the surface close the dialog while
        // a submission is in flight - that would orphan the request.
        if (busy) return;
        if (!data.open) onCancel();
      }}
      modalType="modal"
    >
      <DialogSurface aria-describedby={undefined} data-testid={testId}>
        <form onSubmit={handleFormSubmit}>
          <DialogBody>
            <DialogTitle data-testid={`${testId}-title`}>{title}</DialogTitle>
            <DialogContent>
              {errorMessage && (
                <div
                  className={classes.errorBanner}
                  role="alert"
                  data-testid={`${testId}-error`}
                >
                  {errorMessage}
                </div>
              )}
              <div className={classes.fields} data-testid={`${testId}-fields`}>
                {children}
              </div>
            </DialogContent>
            <DialogActions>
              {busy && (
                <span className={classes.busyHint} data-testid={`${testId}-busy`}>
                  <Spinner size="extra-tiny" /> Working...
                </span>
              )}
              <Button
                appearance="secondary"
                onClick={onCancel}
                disabled={busy}
                data-testid={`${testId}-cancel`}
                type="button"
              >
                {cancelLabel}
              </Button>
              <Button
                appearance="primary"
                disabled={busy || disabled}
                data-testid={`${testId}-submit`}
                type="submit"
              >
                {submitLabel}
              </Button>
            </DialogActions>
          </DialogBody>
        </form>
      </DialogSurface>
    </Dialog>
  );
};
