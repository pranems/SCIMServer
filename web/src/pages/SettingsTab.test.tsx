/**
 * SettingsTab tests (Phase E2: interactive config flag toggles).
 *
 * The tab renders one Switch per known boolean flag (sourced from
 * useEndpointOverview().configFlags), and toggling a switch fires
 * useUpdateEndpointConfig with the body shape
 *   { profile: { settings: { <flag>: <new boolean> } } }.
 * Coercion: 'True' / 'False' string values are normalised to booleans
 * so the Entra-style profile preset round-trip displays correctly.
 *
 * The hook's optimistic deep-merge (covered by mutations.test.ts) is
 * what makes the flip feel instant; the component just wires the
 * mutate call and surfaces success / error feedback.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SettingsTab } from './SettingsTab';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: vi.fn(),
    useUpdateEndpointConfig: vi.fn(),
  };
});

import { useEndpointOverview, useUpdateEndpointConfig } from '../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const EP_ID = 'ep-1';

function overviewWith(configFlags: Record<string, unknown>): EndpointOverviewResponse {
  return {
    endpoint: { id: EP_ID, name: 'prod', preset: 'entra-id', active: true, scimBasePath: '/scim/endpoints/ep-1/v2', createdAt: '2026-01-01' },
    stats: { userCount: 0, activeUserCount: 0, groupCount: 0, activeGroupCount: 0, genericResourceCount: 0 },
    credentials: [],
    recentActivity: [],
    configFlags,
  };
}

describe('SettingsTab', () => {
  let mutateAsync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mutateAsync = vi.fn().mockResolvedValue({});
    (useUpdateEndpointConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync,
      isPending: false,
      variables: undefined,
      error: null,
    });
  });

  it('shows loading state while overview is loading', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-loading')).toBeInTheDocument();
  });

  it('shows error state when overview fetch fails', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('boom'),
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-error')).toBeInTheDocument();
  });

  it('renders general info card (name, SCIM path, status)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: true }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByText('prod')).toBeInTheDocument();
    expect(screen.getByText(/\/scim\/endpoints\/ep-1\/v2/)).toBeInTheDocument();
    // Status badge renders the literal 'Active' text exactly once.
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders a Switch for every known boolean flag', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByRole('switch', { name: /StrictSchemaValidation/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /RequireIfMatch/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /PerEndpointCredentialsEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /UserSoftDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /UserHardDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /GroupHardDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /MultiMemberPatchOpForGroupEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SchemaDiscoveryEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /AllowAndCoerceBooleanStrings/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /VerbosePatchSupported/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /PatchOpAllowRemoveAllMembers/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /IncludeWarningAboutIgnoredReadOnlyAttribute/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /IgnoreReadOnlyAttributesInPatch/i })).toBeInTheDocument();
  });

  it('reflects the current value (boolean true) as a checked Switch', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: true }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /StrictSchemaValidation/i }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
  });

  it('coerces "True" string values (Entra style) to a checked Switch', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: 'True' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /StrictSchemaValidation/i }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
  });

  it('coerces "False" string values to an unchecked Switch', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: 'False' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /StrictSchemaValidation/i }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
  });

  it('falls back to documented defaults when the flag is absent', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    // AllowAndCoerceBooleanStrings defaults to true per ProfileSettings docs.
    const allow = screen.getByRole('switch', { name: /AllowAndCoerceBooleanStrings/i }) as HTMLInputElement;
    expect(allow.checked).toBe(true);
    // PerEndpointCredentialsEnabled defaults to false (security-default).
    const creds = screen.getByRole('switch', { name: /PerEndpointCredentialsEnabled/i }) as HTMLInputElement;
    expect(creds.checked).toBe(false);
  });

  it('toggling a Switch fires useUpdateEndpointConfig with profile.settings shape', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: false }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /StrictSchemaValidation/i });
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { StrictSchemaValidation: true } },
    });
  });

  it('toggling an "on" Switch sends false to the server', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ RequireIfMatch: true }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /RequireIfMatch/i });
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { RequireIfMatch: false } },
    });
  });

  it('shows a success MessageBar after a successful toggle', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: false }),
      isLoading: false, error: null,
    });
    mutateAsync.mockResolvedValueOnce({});
    wrap(<SettingsTab endpointId={EP_ID} />);
    await user.click(screen.getByRole('switch', { name: /StrictSchemaValidation/i }));
    await waitFor(() => {
      expect(screen.getByTestId('settings-feedback-success')).toBeInTheDocument();
    });
  });

  it('shows an error MessageBar when the mutation rejects', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: false }),
      isLoading: false, error: null,
    });
    mutateAsync.mockRejectedValueOnce(new Error('HTTP 500'));
    wrap(<SettingsTab endpointId={EP_ID} />);
    await user.click(screen.getByRole('switch', { name: /StrictSchemaValidation/i }));
    await waitFor(() => {
      expect(screen.getByTestId('settings-feedback-error')).toBeInTheDocument();
    });
  });

  it('disables the Switch currently being mutated (variables match flag key)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: false }),
      isLoading: false, error: null,
    });
    (useUpdateEndpointConfig as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync,
      isPending: true,
      variables: { profile: { settings: { StrictSchemaValidation: true } } },
      error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /StrictSchemaValidation/i }) as HTMLInputElement;
    expect(sw.disabled).toBe(true);
  });

  it('renders the PrimaryEnforcement value as read-only info (not a Switch)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ PrimaryEnforcement: 'reject' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    // PrimaryEnforcement key is rendered exactly once (as a row label).
    expect(screen.getByText('PrimaryEnforcement')).toBeInTheDocument();
    // Badge renders the value exactly.
    expect(screen.getByText('reject')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /PrimaryEnforcement/i })).toBeNull();
  });
});
