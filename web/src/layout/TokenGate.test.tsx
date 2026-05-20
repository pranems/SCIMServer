/**
 * TokenGate.test.tsx
 *
 * Covers the post-token-save error-screen RCA (2026-05-20):
 *   Bug 1: TanStack Router loaders fire before authentication, producing a
 *          loader-error state that persists after the dialog closes.
 *   Bug 2: fetchWithAuth fired TOKEN_INVALID_EVENT even when there was no
 *          token to begin with, causing a spurious "Token expired" message.
 *          (Tested in queries.test.ts - fetchWithAuth no-token short-circuit.)
 *   Bug 3: After saving a token, router.invalidate() must be called so TanStack
 *          Router re-runs its loaders with the new token, clearing the error
 *          state. Without it the route shows "Something went wrong" until the
 *          user hard-refreshes.
 *
 * Tests in this file:
 *   1. Shows dialog when there is no stored token.
 *   2. Hides dialog + calls router.invalidate() after a valid token is saved.
 *   3. Shows dialog + sets error message on TOKEN_INVALID_EVENT.
 *   4. Renders children when a token is already stored (happy-path entry).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { TokenGate } from './TokenGate';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetStoredToken = vi.fn(() => null as string | null);
const mockSetStoredToken = vi.fn();
const mockInvalidate = vi.fn();
const mockInvalidateQueries = vi.fn();

vi.mock('../auth/token', () => ({
  getStoredToken: () => mockGetStoredToken(),
  setStoredToken: (token: string) => mockSetStoredToken(token),
  clearStoredToken: vi.fn(),
  notifyTokenInvalid: vi.fn(),
  TOKEN_INVALID_EVENT: 'scimserver:token-invalid',
  TOKEN_CHANGED_EVENT: 'scimserver:token-changed',
  TOKEN_STORAGE_KEY: 'scimserver.authToken',
}));

// Stub @tanstack/react-router's useRouter - provides the invalidate() spy.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: mockInvalidate }),
}));

// Stub @tanstack/react-query's useQueryClient.
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

// Stub Fluent UI to keep the test lightweight (no full Fluent provider
// context needed). The stub renders a minimal div so RTL can query by
// data-testid and fire events.
vi.mock('@fluentui/react-components', async () => {
  const actual = await vi.importActual<typeof import('@fluentui/react-components')>('@fluentui/react-components');
  return {
    ...actual,
    Dialog: ({ children }: { children: React.ReactNode }) => <div data-testid="fluent-dialog">{children}</div>,
    DialogSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    DialogContent: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
    DialogActions: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Input: ({ value, onChange, onKeyDown, 'data-testid': tid }: {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
      onKeyDown?: React.KeyboardEventHandler;
      autoFocus?: boolean;
      'data-testid'?: string;
    }) => (
      <input
        data-testid={tid ?? 'token-input'}
        value={value}
        onChange={(e) => onChange?.({} as React.ChangeEvent<HTMLInputElement>, { value: e.target.value })}
        onKeyDown={onKeyDown}
      />
    ),
    Button: ({ children, onClick, 'data-testid': tid }: React.ButtonHTMLAttributes<HTMLButtonElement> & { 'data-testid'?: string; appearance?: string }) => (
      <button data-testid={tid ?? 'button'} onClick={onClick}>{children}</button>
    ),
    Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
    makeStyles: () => () => ({}),
    tokens: { colorNeutralForeground3: '', colorPaletteRedForeground1: '', borderRadiusMedium: '' },
  };
});

vi.mock('@fluentui/react-icons', () => ({
  Key24Regular: () => null,
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function renderGate(hasToken = false) {
  mockGetStoredToken.mockReturnValue(hasToken ? 'existing-token' : null);
  return render(
    <TokenGate>
      <div data-testid="children">app content</div>
    </TokenGate>,
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('TokenGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the auth dialog when there is no stored token', () => {
    renderGate(false);
    expect(screen.getByTestId('fluent-dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
  });

  it('renders children directly when a token is already stored', () => {
    renderGate(true);
    expect(screen.queryByTestId('fluent-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('calls setStoredToken + router.invalidate() + queryClient.invalidateQueries() after saving a token (Bug 3 fix)', () => {
    // This test locks the RCA fix: router.invalidate() MUST be called after
    // the token is saved so TanStack Router re-runs its active loaders and
    // clears the loader-error state produced during the pre-authentication
    // window. Without it the user sees "Something went wrong" immediately
    // after the dialog closes.
    renderGate(false);

    const input = screen.getByTestId('token-input');
    fireEvent.change(input, { target: { value: 'my-token' } });

    const saveBtn = screen.getByTestId('token-save');
    fireEvent.click(saveBtn);

    expect(mockSetStoredToken).toHaveBeenCalledWith('my-token');
    expect(mockInvalidateQueries).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalled(); // router.invalidate()
    // Dialog must be gone; children must be rendered
    expect(screen.queryByTestId('fluent-dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('re-shows the dialog with an error message on TOKEN_INVALID_EVENT', async () => {
    renderGate(true); // starts with a token -> children visible
    expect(screen.queryByTestId('fluent-dialog')).not.toBeInTheDocument();

    // Simulate a 401 arriving from the server -> fetchWithAuth dispatches this event.
    // Wrap in act() because dispatchEvent on window is outside React's synthetic
    // event system; without act() the state update is batched but RTL won't flush it.
    await act(async () => {
      window.dispatchEvent(new CustomEvent('scimserver:token-invalid'));
    });

    expect(screen.getByTestId('fluent-dialog')).toBeInTheDocument();
    expect(screen.getByText(/Token expired or invalid/i)).toBeInTheDocument();
  });

  it('does not save an empty/whitespace-only token', () => {
    renderGate(false);
    const saveBtn = screen.getByTestId('token-save');
    fireEvent.click(saveBtn); // no input = empty
    expect(mockSetStoredToken).not.toHaveBeenCalled();
    expect(mockInvalidate).not.toHaveBeenCalled();
    expect(screen.getByTestId('fluent-dialog')).toBeInTheDocument(); // dialog still open
  });
});
