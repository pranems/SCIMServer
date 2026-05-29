/**
 * CommandPalette tests (Phase F1).
 *
 * The palette is a shared chrome-level overlay opened with Cmd+K (mac) or
 * Ctrl+K (others). It surfaces three source groups:
 *   1. Routes - hard-coded list mirroring the TanStack Router top-level tree.
 *   2. Endpoints - dynamic, sourced from useEndpoints (filtered by typed query).
 *   3. Quick actions - "Create user", "Create group", "View logs".
 *
 * Each item is keyboard-navigable (cmdk handles arrow keys + Enter); selecting
 * an item closes the palette and either navigates (Link semantics) or invokes
 * an action callback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CommandPalette } from './CommandPalette';
import type { EndpointListResponse } from '@scim/types/dashboard.types';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return { ...actual, useEndpoints: vi.fn() };
});

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

import { useEndpoints } from '../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const ENDPOINTS: EndpointListResponse = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-1', name: 'prod', displayName: 'Production', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: { self: '', stats: '', credentials: '', scim: '' } },
    { id: 'ep-2', name: 'staging', displayName: 'Staging', active: true, scimBasePath: '', createdAt: '', updatedAt: '', _links: { self: '', stats: '', credentials: '', scim: '' } },
  ],
};

describe('CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
  });

  it('does not render when open=false', () => {
    wrap(<CommandPalette open={false} onOpenChange={() => undefined} />);
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('renders the dialog and search input when open', () => {
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Type a command/i)).toBeInTheDocument();
  });

  it('lists every top-level route as a navigable item', () => {
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    expect(screen.getByText(/Go to Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to Endpoints/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to Logs/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to Settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Go to Manual Provision/i)).toBeInTheDocument();
  });

  it('lists each endpoint by displayName', () => {
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    expect(screen.getByText(/Production/)).toBeInTheDocument();
    expect(screen.getByText(/Staging/)).toBeInTheDocument();
  });

  it('lists quick actions', () => {
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    expect(screen.getByText(/Create user/i)).toBeInTheDocument();
    expect(screen.getByText(/Create group/i)).toBeInTheDocument();
  });

  it('selecting a route item navigates and closes the palette', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    wrap(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(screen.getByText(/Go to Endpoints/i));
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/endpoints' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selecting an endpoint item navigates to the endpoint detail and closes', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    wrap(<CommandPalette open onOpenChange={onOpenChange} />);
    await user.click(screen.getByText(/Production/));
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({ to: '/endpoints/$endpointId', params: { endpointId: 'ep-1' } }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('typing in the search filters items down', async () => {
    const user = userEvent.setup();
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    const input = screen.getByPlaceholderText(/Type a command/i);
    await user.type(input, 'Staging');
    // Production is now hidden (cmdk filters to matching entries only).
    expect(screen.queryByText(/Production/)).not.toBeInTheDocument();
    expect(screen.getByText(/Staging/)).toBeInTheDocument();
  });

  it('Escape key closes the palette', async () => {
    const onOpenChange = vi.fn();
    wrap(<CommandPalette open onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

// ─── Phase N6: Custom commands group ────────────────────────────────

describe('CommandPalette - Custom commands group (Phase N6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
  });

  it('renders custom commands registered into commandRegistry', async () => {
    const { commandRegistry } = await import('../store/command-registry');
    commandRegistry.clear();
    commandRegistry.register({ id: 'do.thing', label: 'Do a registered thing', run: vi.fn() });
    commandRegistry.register({ id: 'do.other', label: 'Do another thing', run: vi.fn() });

    wrap(<CommandPalette open onOpenChange={() => undefined} />);

    expect(screen.getByTestId('command-palette-custom-do.thing')).toBeInTheDocument();
    expect(screen.getByTestId('command-palette-custom-do.other')).toBeInTheDocument();
  });

  it('does NOT render the Custom commands group when registry is empty', async () => {
    const { commandRegistry } = await import('../store/command-registry');
    commandRegistry.clear();
    wrap(<CommandPalette open onOpenChange={() => undefined} />);
    expect(screen.queryByText(/Custom commands/i)).not.toBeInTheDocument();
  });

  it('selecting a registered command runs its handler and closes the palette', async () => {
    const { commandRegistry } = await import('../store/command-registry');
    commandRegistry.clear();
    const handler = vi.fn();
    commandRegistry.register({ id: 'do.click', label: 'Click me', run: handler });

    const onOpenChange = vi.fn();
    wrap(<CommandPalette open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('command-palette-custom-do.click'));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('global Cmd+K shortcut', () => {
  it('Cmd+K (mac) toggles the palette open', async () => {
    const onOpenChange = vi.fn();
    wrap(<CommandPalette open={false} onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it('Ctrl+K (windows / linux) toggles the palette open', async () => {
    const onOpenChange = vi.fn();
    wrap(<CommandPalette open={false} onOpenChange={onOpenChange} />);
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });
});
