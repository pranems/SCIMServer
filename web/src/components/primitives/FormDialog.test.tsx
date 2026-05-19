/**
 * FormDialog primitive tests.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { FormDialog } from './FormDialog';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('FormDialog', () => {
  it('does not render the dialog when open=false', () => {
    wrap(
      <FormDialog open={false} onCancel={() => {}} onSubmit={() => {}} title="Add credential">
        <input data-testid="x" />
      </FormDialog>,
    );
    expect(screen.queryByTestId('form-dialog')).not.toBeInTheDocument();
  });

  it('renders title and fields when open', () => {
    wrap(
      <FormDialog open={true} onCancel={() => {}} onSubmit={() => {}} title="Add credential">
        <input data-testid="cred-label-input" />
      </FormDialog>,
    );
    expect(screen.getByTestId('form-dialog-title')).toHaveTextContent('Add credential');
    expect(screen.getByTestId('cred-label-input')).toBeInTheDocument();
  });

  it('clicking submit invokes onSubmit', () => {
    const onSubmit = vi.fn();
    wrap(
      <FormDialog open={true} onCancel={() => {}} onSubmit={onSubmit} title="X">
        <span>fields</span>
      </FormDialog>,
    );
    fireEvent.click(screen.getByTestId('form-dialog-submit'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('clicking cancel invokes onCancel and not onSubmit', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    wrap(
      <FormDialog open={true} onCancel={onCancel} onSubmit={onSubmit} title="X">
        <span>fields</span>
      </FormDialog>,
    );
    fireEvent.click(screen.getByTestId('form-dialog-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('busy=true disables both buttons and shows the busy hint', () => {
    const onSubmit = vi.fn();
    wrap(
      <FormDialog open={true} onCancel={() => {}} onSubmit={onSubmit} title="X" busy={true}>
        <span>fields</span>
      </FormDialog>,
    );
    expect(screen.getByTestId('form-dialog-busy')).toBeInTheDocument();
    expect(screen.getByTestId('form-dialog-submit')).toBeDisabled();
    expect(screen.getByTestId('form-dialog-cancel')).toBeDisabled();
    fireEvent.click(screen.getByTestId('form-dialog-submit'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('disabled=true keeps cancel enabled but blocks submit', () => {
    const onSubmit = vi.fn();
    wrap(
      <FormDialog open={true} onCancel={() => {}} onSubmit={onSubmit} title="X" disabled={true}>
        <span>fields</span>
      </FormDialog>,
    );
    expect(screen.getByTestId('form-dialog-submit')).toBeDisabled();
    expect(screen.getByTestId('form-dialog-cancel')).not.toBeDisabled();
  });

  it('renders the error banner when errorMessage is set', () => {
    wrap(
      <FormDialog
        open={true}
        onCancel={() => {}}
        onSubmit={() => {}}
        title="X"
        errorMessage="Server returned 409"
      >
        <span>fields</span>
      </FormDialog>,
    );
    expect(screen.getByTestId('form-dialog-error')).toHaveTextContent('Server returned 409');
  });

  it('honors a custom data-testid', () => {
    wrap(
      <FormDialog
        data-testid="cred-form"
        open={true}
        onCancel={() => {}}
        onSubmit={() => {}}
        title="X"
      >
        <span>fields</span>
      </FormDialog>,
    );
    expect(screen.getByTestId('cred-form')).toBeInTheDocument();
    expect(screen.getByTestId('cred-form-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('form-dialog')).not.toBeInTheDocument();
  });
});
