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
    expect(screen.getByRole('switch', { name: /PerEndpointCredentialsEnabled/i })).toBeInTheDocument();
    // WI-11: the per-method auth-enablement flag family.
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
    expect(screen.getByRole('switch', { name: /CustomResourceTypesEnabled/i })).toBeInTheDocument();
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

  it('reflects CustomResourceTypesEnabled and toggles it via profile.settings', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ CustomResourceTypesEnabled: 'True' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /CustomResourceTypesEnabled/i }) as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await user.click(sw);
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { CustomResourceTypesEnabled: false } },
    });
  });

  it('defaults CustomResourceTypesEnabled to off when the flag is absent', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const sw = screen.getByRole('switch', { name: /CustomResourceTypesEnabled/i }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
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

  // ── WI-7: CredentialSecretVisibility enum control ─────────────────
  it('renders the CredentialSecretVisibility control defaulting to always', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    expect(screen.getByTestId('settings-credential-visibility')).toBeInTheDocument();
    const always = screen.getByTestId('credential-visibility-always') as HTMLInputElement;
    expect(always.checked).toBe(true);
  });

  it('reflects a stored CredentialSecretVisibility=once', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ CredentialSecretVisibility: 'once' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const once = screen.getByTestId('credential-visibility-once') as HTMLInputElement;
    expect(once.checked).toBe(true);
  });

  it('selecting "once" fires useUpdateEndpointConfig with the enum value', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ CredentialSecretVisibility: 'always' }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    await user.click(screen.getByTestId('credential-visibility-once'));
    expect(mutateAsync).toHaveBeenCalledWith({
      profile: { settings: { CredentialSecretVisibility: 'once' } },
    });
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

  it('renders the PersistRequestSecrets switch under Logging & privacy (defaults ON)', () => {
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({}),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    const card = screen.getByTestId('settings-category-logging-privacy');
    expect(card).toBeInTheDocument();
    const sw = screen.getByRole('switch', { name: /PersistRequestSecrets/i });
    expect(sw).toBeInTheDocument();
    // Default (unset) shows ON - the request log keeps the full request for RCA.
    expect(sw).toBeChecked();
  });

  it('toggling PersistRequestSecrets OFF fires the config update with false', async () => {
    const user = userEvent.setup();
    (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
      data: overviewWith({ PersistRequestSecrets: true }),
      isLoading: false, error: null,
    });
    wrap(<SettingsTab endpointId={EP_ID} />);
    await user.click(screen.getByRole('switch', { name: /PersistRequestSecrets/i }));
    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ profile: { settings: { PersistRequestSecrets: false } } });
    });
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

    it('reflects the persisted value and leaves unset fields blank (inherit default)', () => {
      (useEndpointOverview as ReturnType<typeof vi.fn>).mockReturnValue({
        data: overviewWith({ JwksFetchTimeoutMs: 1500 }),
        isLoading: false, error: null,
      });
      wrap(<SettingsTab endpointId={EP_ID} />);
      const setInput = screen.getByTestId('settings-number-JwksFetchTimeoutMs-input') as HTMLInputElement;
      expect(setInput.value).toBe('1500');
      const unsetInput = screen.getByTestId('settings-number-JwksFetchRetries-input') as HTMLInputElement;
      expect(unsetInput.value).toBe('');
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
