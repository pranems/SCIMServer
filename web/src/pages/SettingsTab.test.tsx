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
    useEndpointEgressPolicy: vi.fn(),
    useUpdateEndpointConfig: vi.fn(),
  };
});

import { useEndpointEgressPolicy, useEndpointOverview, useUpdateEndpointConfig } from '../api/queries';

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
    connectionInfo: {
      endpointId: EP_ID,
      displayName: 'prod',
      urls: {
        scimBaseUrl: 'https://x/scim/v2/endpoints/ep-1',
        scimBaseUrlBare: 'https://x/scim/endpoints/ep-1',
        tokenEndpoint: 'https://x/scim/endpoints/ep-1/oauth/token',
        serviceProviderConfig: 'https://x/scim/v2/endpoints/ep-1/ServiceProviderConfig',
        oauthMetadata: 'https://x/scim/endpoints/ep-1/.well-known/oauth-authorization-server',
      },
      enabledMethods: [],
      disabledMethods: [],
    },
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
    const field = (effective: number, unit: 'ms' | 'bytes' | 'count', min: number, max: number) => ({
      effective,
      configured: null,
      source: 'server-env' as const,
      unit,
      min,
      max,
      clamped: false,
    });
    (useEndpointEgressPolicy as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        timeoutMs: field(4321, 'ms', 100, 60000),
        retries: field(3, 'count', 0, 10),
        retryBackoffMs: field(250, 'ms', 0, 10000),
        cacheMaxAgeMs: field(86400000, 'ms', 0, 86400000),
        totalDeadlineMs: field(10000, 'ms', 100, 120000),
        maxResponseBytes: field(1048576, 'bytes', 1024, 10485760),
        maxKeys: field(100, 'count', 1, 1000),
        maxCacheEntries: field(50, 'count', 1, 1000),
        refreshIntervalMs: field(3600000, 'ms', 60000, 86400000),
        unknownKidMinIntervalMs: field(300000, 'ms', 0, 3600000),
        staleIfErrorMs: field(172800000, 'ms', 0, 604800000),
      },
      isLoading: false,
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

  it('exposes a Copy/Download settings-as-JSON export (PATCH-body shape)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ StrictSchemaValidation: true, CredentialSecretVisibility: 'once' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-tab-export')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-export-copy')).toBeInTheDocument();
    expect(screen.getByTestId('settings-tab-export-download')).toBeInTheDocument();
  });

  it('renders a Switch for every known boolean flag', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByRole('switch', { name: /StrictSchemaValidation/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /RequireIfMatch/i })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /PerEndpointCredentialsEnabled/i })).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SecretTokenBearerAuthEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /OAuthClientCredentialsAuthEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SharedSecretBearerAuthEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /WifCredentialsEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /UserSoftDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /UserHardDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /GroupHardDeleteEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /MultiMemberPatchOpForGroupEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /SchemaDiscoveryEnabled/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /EnforceResourceTypes/i })).toBeInTheDocument();
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
    const bearer = screen.getByRole('switch', { name: /SecretTokenBearerAuthEnabled/i }) as HTMLInputElement;
    const oauth = screen.getByRole('switch', { name: /OAuthClientCredentialsAuthEnabled/i }) as HTMLInputElement;
    expect(bearer.checked).toBe(false);
    expect(oauth.checked).toBe(false);
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

  it('reflects SchemaDiscoveryEnabled and toggles it via profile.settings', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ SchemaDiscoveryEnabled: 'True' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /SchemaDiscoveryEnabled/i }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { SchemaDiscoveryEnabled: false } },
    });
  });

  it('does NOT offer a toggle for the retired CustomResourceTypesEnabled flag', () => {
    // settings-v8 retired it and the server derives the capability from
    // profile.resourceTypes. A toggle here wrote a setting nothing reads.
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ CustomResourceTypesEnabled: 'True' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.queryByRole('switch', { name: /CustomResourceTypesEnabled/i })).not.toBeInTheDocument();
  });

  // RfcCompliantSubAttributes - RFC 7643 sub-attribute handling.
  // Asserts the OUTCOME (rendered checked-state and the exact mutation payload),
  // not merely that a Switch exists: a presence-only assertion would pass even
  // if the flag defaulted the wrong way, which is the one thing that matters
  // here because the whole point is that current behavior stays the default.
  it('defaults RfcCompliantSubAttributes to OFF when the flag is absent', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /RfcCompliantSubAttributes/i }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
  });

  it('reflects RfcCompliantSubAttributes=true and toggles it back off via profile.settings', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ RfcCompliantSubAttributes: 'True' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /RfcCompliantSubAttributes/i }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { RfcCompliantSubAttributes: false } },
    });
  });

  it('turns RfcCompliantSubAttributes ON from the default off state', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /RfcCompliantSubAttributes/i }) as HTMLInputElement;
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { RfcCompliantSubAttributes: true } },
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

  // ── CredentialSecretVisibility always-retain policy ───────────────
  it('renders the fixed always-retain credential policy', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-credential-visibility')).toBeInTheDocument();
    expect(screen.getByTestId('credential-visibility-always')).toHaveTextContent(
      'always (retain encrypted + display to authenticated admins)',
    );
    expect(screen.queryByTestId('credential-visibility-once')).not.toBeInTheDocument();
  });

  it('marks legacy once-only credentials as rotation-required', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ CredentialSecretVisibility: 'once' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-credential-visibility')).toHaveTextContent(
      'Existing credentials created under the retired once-only policy remain unavailable until rotated.',
    );
    expect(screen.queryByTestId('credential-visibility-once')).not.toBeInTheDocument();
  });

  it('renders PrimaryEnforcement as an editable Dropdown (not a Switch, not read-only)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ PrimaryEnforcement: 'reject' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    // Rendered as an enum Dropdown row reflecting the current value.
    const dropdown = screen.getByTestId('settings-enum-PrimaryEnforcement-dropdown');
    expect(dropdown).toBeInTheDocument();
    expect(dropdown.textContent).toContain('reject');
    // It is NOT a Switch.
    expect(screen.queryByRole('switch', { name: /PrimaryEnforcement/i })).toBeNull();
  });

  it('groups boolean flags into related-category cards', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-category-authentication-methods')).toBeInTheDocument();
    expect(screen.getByTestId('settings-category-validation-schema')).toBeInTheDocument();
    expect(screen.getByTestId('settings-category-patch-semantics')).toBeInTheDocument();
    expect(screen.getByTestId('settings-category-lifecycle-deletes')).toBeInTheDocument();
    // The auth-method switches live under the Authentication methods card.
    const authCard = screen.getByTestId('settings-category-authentication-methods');
    expect(authCard.querySelector('[aria-label="WifCredentialsEnabled"]')).not.toBeNull();
  });

  it('shows a method-managed effective value and blocks the shadow settings write', async () => {
    const user = userEvent.setup();
    const overview = overviewWith({ SecretTokenBearerAuthEnabled: true });
    overview.connectionInfo.disabledMethods.push({
      method: 'bearer',
      enablementSource: 'authentication-method',
      reason: 'Disabled by the authentication method entry',
      enableHint: 'Change this method in Connect',
    });
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overview,
      isLoading: false,
      error: null,
    });

    wrap(<SettingsTab endpointId={EP_ID} />);

    const bearer = screen.getByTestId('settings-flag-SecretTokenBearerAuthEnabled');
    expect(bearer).not.toBeChecked();
    expect(bearer).toBeDisabled();
    expect(screen.getByTestId('settings-flag-source-SecretTokenBearerAuthEnabled')).toHaveTextContent(
      'Managed by Authentication methods. Change it in Connect.',
    );
    await user.click(bearer);
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('renders fixed request-log redaction instead of a PersistRequestSecrets switch', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-log-secret-persistence')).toHaveTextContent('always redacted');
    expect(screen.queryByRole('switch', { name: /PersistRequestSecrets/i })).not.toBeInTheDocument();
  });

  it('logLevel renders as an enum Dropdown with the log levels', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ logLevel: 'WARN' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const dropdown = screen.getByTestId('settings-enum-logLevel-dropdown');
    expect(dropdown).toBeInTheDocument();
    expect(dropdown.textContent).toContain('WARN');
  });

  // ── Runtime egress (WIF JWKS fetch) numeric overrides ─────────────
  describe('runtime egress number settings', () => {
    it('renders a number input for each of the 4 egress params', () => {
      (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        data: overviewWith({}),
        isLoading: false, error: null,
      });
      wrap(<SettingsTab endpointId={EP_ID} />);
      expect(screen.getByTestId('settings-number-settings')).toBeInTheDocument();
      // Each input carries its type + bounds contract (validates the Playwright
      // bounded-input assertions run against the same rendered DOM).
      const bounds: Record<string, { min: string; max: string }> = {
        JwksFetchTimeoutMs: { min: '100', max: '60000' },
        JwksFetchRetries: { min: '0', max: '10' },
        JwksFetchRetryBackoffMs: { min: '0', max: '10000' },
        JwksCacheMaxAgeMs: { min: '0', max: '86400000' },
      };
      for (const [key, b] of Object.entries(bounds)) {
        const input = screen.getByTestId(`settings-number-${key}-input`);
        expect(input).toHaveAttribute('type', 'number');
        expect(input).toHaveAttribute('min', b.min);
        expect(input).toHaveAttribute('max', b.max);
      }
    });

    it('shows configured overrides and real inherited effective values with source and units', () => {
      (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        data: overviewWith({ JwksFetchTimeoutMs: 1500 }),
        isLoading: false, error: null,
      });
      wrap(<SettingsTab endpointId={EP_ID} />);
      const setInput = screen.getByTestId('settings-number-JwksFetchTimeoutMs-input') as HTMLInputElement;
      expect(setInput.value).toBe('1500');
      const unsetInput = screen.getByTestId('settings-number-JwksFetchRetries-input') as HTMLInputElement;
      expect(unsetInput.value).toBe('3');
      expect(screen.getByTestId('settings-number-JwksFetchRetries-effective')).toHaveTextContent(
        'Effective: 3 count',
      );
      expect(screen.getByTestId('settings-number-JwksFetchRetries-source')).toHaveTextContent(
        'Server environment',
      );
    });

    it('fires the config update with the new numeric value on blur', async () => {
      const user = userEvent.setup();
      (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        data: overviewWith({}),
        isLoading: false, error: null,
      });
      wrap(<SettingsTab endpointId={EP_ID} />);
      const input = screen.getByTestId('settings-number-JwksFetchTimeoutMs-input');
      await user.click(input);
      await user.clear(input);
      await user.type(input, '2500');
      await user.tab(); // blur
      await waitFor(() => {
        expect(mutateAsync).toHaveBeenCalledWith({ profile: { settings: { JwksFetchTimeoutMs: 2500 } } });
      });
    });

    it('rejects an out-of-range value with an error message and no update', async () => {
      const user = userEvent.setup();
      (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        data: overviewWith({}),
        isLoading: false, error: null,
      });
      wrap(<SettingsTab endpointId={EP_ID} />);
      const input = screen.getByTestId('settings-number-JwksFetchRetries-input');
      await user.click(input);
      await user.type(input, '99'); // max is 10
      await user.tab();
      await waitFor(() => {
        expect(screen.getByTestId('settings-feedback-error')).toBeInTheDocument();
      });
      expect(mutateAsync).not.toHaveBeenCalled();
    });
  });
});
