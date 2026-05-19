/**
 * ConflictDialog.test.tsx - Phase K5 conflict-resolution dialog
 * contract.
 *
 * Asserts the dialog raised on a 412 Precondition Failed:
 *   - Renders the user's pending edits and the server's current
 *     state side-by-side.
 *   - Refresh button calls onRefreshAndReapply (the drawer reseeds
 *     the form with server values, keeps the user's diff).
 *   - Force-overwrite button is hidden when ETag is missing
 *     (isForceOverwriteSafe=false).
 *   - Force-overwrite button calls onForceOverwrite when clicked.
 *   - Cancel calls onCancel.
 *
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ConflictDialog } from './ConflictDialog';

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

const PENDING = { displayName: 'My new name', active: false };
const SERVER_RESOURCE = { id: 'u1', meta: { version: 'W/"v3"' }, displayName: 'Server name', active: true };

describe('ConflictDialog', () => {
  it('renders nothing when open=false', () => {
    renderWithFluent(
      <ConflictDialog
        open={false}
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('conflict-dialog')).toBeNull();
  });

  it('renders the dialog with both your-edits and server-state columns when open', () => {
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('conflict-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('conflict-pending')).toBeInTheDocument();
    expect(screen.getByTestId('conflict-server')).toBeInTheDocument();
    // Both column bodies surface the actual values.
    expect(screen.getByTestId('conflict-pending').textContent).toContain('My new name');
    expect(screen.getByTestId('conflict-server').textContent).toContain('Server name');
  });

  it('shows the server ETag (v3) so the operator knows the version they collide with', () => {
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByTestId('conflict-server-etag').textContent).toContain('v3');
  });

  it('Refresh button fires onRefreshAndReapply', async () => {
    const onRefresh = vi.fn();
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={onRefresh}
        onForceOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('conflict-refresh'));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it('Force overwrite button fires onForceOverwrite', async () => {
    const onForce = vi.fn();
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={onForce}
        onCancel={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByTestId('conflict-force-overwrite'));
    expect(onForce).toHaveBeenCalledOnce();
  });

  it('hides the Force overwrite button when serverResource has no version (unsafe)', () => {
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={{ id: 'u1' /* no meta */ }}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('conflict-force-overwrite')).toBeNull();
  });

  it('Cancel button fires onCancel', async () => {
    const onCancel = vi.fn();
    renderWithFluent(
      <ConflictDialog
        open
        pendingDiff={PENDING}
        serverResource={SERVER_RESOURCE}
        onRefreshAndReapply={vi.fn()}
        onForceOverwrite={vi.fn()}
        onCancel={onCancel}
      />,
    );
    await userEvent.click(screen.getByTestId('conflict-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
