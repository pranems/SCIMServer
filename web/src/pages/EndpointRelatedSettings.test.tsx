import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EndpointRelatedSettings } from './EndpointRelatedSettings';
import { TAB_SETTING_KEYS } from './endpoint-settings-definitions';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

const mockUseEndpointOverview = vi.fn();
const mockUseEndpointEgressPolicy = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: (...args: unknown[]) => mockUseEndpointOverview(...args),
    useEndpointEgressPolicy: (...args: unknown[]) => mockUseEndpointEgressPolicy(...args),
    useUpdateEndpointConfig: () => ({
      mutateAsync: mockMutateAsync,
      isPending: false,
      variables: undefined,
      error: null,
    }),
  };
});

const overview: EndpointOverviewResponse = {
  endpoint: {
    id: 'ep-1',
    name: 'related-settings-test',
    preset: 'custom',
    active: true,
    scimBasePath: '/scim/endpoints/ep-1',
    createdAt: '2026-09-15T00:00:00Z',
  },
  stats: {
    userCount: 0,
    activeUserCount: 0,
    groupCount: 0,
    activeGroupCount: 0,
    genericResourceCount: 0,
  },
  credentials: [],
  recentActivity: [],
  configFlags: {
    UserSoftDeleteEnabled: true,
    PrimaryEnforcement: 'reject',
    MaxActiveBearerCredentials: 5,
  },
  connectionInfo: {
    endpointId: 'ep-1',
    displayName: 'related-settings-test',
    urls: {
      scimBaseUrl: 'https://example/scim/v2/endpoints/ep-1',
      scimBaseUrlBare: 'https://example/scim/endpoints/ep-1',
      tokenEndpoint: 'https://example/scim/endpoints/ep-1/oauth/token',
      serviceProviderConfig: 'https://example/scim/v2/endpoints/ep-1/ServiceProviderConfig',
      oauthMetadata: 'https://example/scim/endpoints/ep-1/.well-known/oauth-authorization-server',
    },
    enabledMethods: [],
    disabledMethods: [],
  },
};

const egressField = (
  effective: number,
  configured: number | null,
  source: 'endpoint' | 'server-env' | 'default',
  unit: 'ms' | 'bytes' | 'count',
  min: number,
  max: number,
  extra: Record<string, unknown> = {},
) => ({ effective, configured, source, unit, min, max, clamped: false, ...extra });

const egressPolicy = {
  timeoutMs: egressField(1200, 1200, 'endpoint', 'ms', 100, 60000),
  retries: egressField(4, null, 'server-env', 'count', 0, 10),
  retryBackoffMs: egressField(200, null, 'default', 'ms', 0, 10000),
  cacheMaxAgeMs: egressField(60000, null, 'server-env', 'ms', 0, 86400000, { clamped: true, requested: 90000000 }),
  totalDeadlineMs: egressField(10000, null, 'default', 'ms', 100, 120000),
  maxResponseBytes: egressField(1048576, null, 'default', 'bytes', 1024, 10485760),
  maxKeys: egressField(100, null, 'default', 'count', 1, 1000),
  maxCacheEntries: egressField(50, null, 'default', 'count', 1, 1000),
  refreshIntervalMs: egressField(3600000, null, 'default', 'ms', 60000, 86400000),
  unknownKidMinIntervalMs: egressField(300000, null, 'default', 'ms', 0, 3600000),
  staleIfErrorMs: egressField(172800000, null, 'default', 'ms', 0, 604800000),
};

function renderPanel(keys: readonly string[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FluentProvider theme={webLightTheme}>
        <EndpointRelatedSettings
          endpointId="ep-1"
          settingKeys={keys}
          title="Related settings"
          data-testid="related-settings"
        />
      </FluentProvider>
    </QueryClientProvider>,
  );
}

function expandPanel() {
  fireEvent.click(screen.getByRole('button', { name: /Related settings/i }));
}

describe('EndpointRelatedSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    mockUseEndpointEgressPolicy.mockReturnValue({ data: egressPolicy, isLoading: false, error: null });
  });

  it('renders boolean, enum and numeric controls from the shared registry', () => {
    renderPanel(['UserSoftDeleteEnabled', 'PrimaryEnforcement', 'MaxActiveBearerCredentials']);

    expect(screen.getByText('3 settings')).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: /User soft delete/i })).not.toBeInTheDocument();
    expandPanel();

    expect(screen.getByRole('switch', { name: /User soft delete/i })).toBeChecked();
    expect(screen.getByRole('combobox', { name: /Primary enforcement/i })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /Maximum active bearer credentials/i })).toHaveValue(5);
    const userSwitch = screen.getByRole('switch', { name: /User soft delete/i });
    expect(userSwitch).toHaveAttribute('aria-describedby', 'related-settings-UserSoftDeleteEnabled-description');
    expect(screen.getByText(/soft-deactivates the user/i)).toHaveAttribute(
      'id',
      'related-settings-UserSoftDeleteEnabled-description',
    );
  });

  it('renders a scoped loading state', () => {
    mockUseEndpointOverview.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderPanel(['UserSoftDeleteEnabled']);

    expect(screen.getByTestId('related-settings-loading')).toBeInTheDocument();
  });

  it('renders a scoped query error state', () => {
    mockUseEndpointOverview.mockReturnValue({ data: undefined, isLoading: false, error: new Error('load failed') });
    renderPanel(['UserSoftDeleteEnabled']);

    expect(screen.getByTestId('related-settings-error')).toHaveTextContent(/could not load/i);
  });

  it('persists a boolean toggle through the standard endpoint-config mutation', async () => {
    renderPanel(['UserSoftDeleteEnabled']);
    expandPanel();
    fireEvent.click(screen.getByRole('switch', { name: /User soft delete/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        profile: { settings: { UserSoftDeleteEnabled: false } },
      }),
    );
  });

  it('surfaces a mutation failure without changing the page contract', async () => {
    mockMutateAsync.mockRejectedValue(new Error('save failed'));
    renderPanel(['UserSoftDeleteEnabled']);
    expandPanel();
    fireEvent.click(screen.getByRole('switch', { name: /User soft delete/i }));

    expect(await screen.findByTestId('related-settings-feedback')).toHaveTextContent(/save failed/i);
  });

  it('persists an enum selection through the same mutation path', async () => {
    renderPanel(['PrimaryEnforcement']);
    expandPanel();
    fireEvent.click(screen.getByRole('combobox', { name: /Primary enforcement/i }));
    fireEvent.click(await screen.findByRole('option', { name: /normalize/i }));

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        profile: { settings: { PrimaryEnforcement: 'normalize' } },
      }),
    );
  });

  it('persists a bounded numeric value through the same mutation path', async () => {
    renderPanel(['MaxActiveBearerCredentials']);
    expandPanel();
    const input = screen.getByRole('spinbutton', { name: /Maximum active bearer credentials/i });
    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(mockMutateAsync).toHaveBeenCalledWith({
        profile: { settings: { MaxActiveBearerCredentials: 7 } },
      }),
    );
  });

  it.each([
    ['7.5', /whole number/i],
    ['26', /between 1 and 25/i],
  ])('rejects invalid numeric input %s without persisting it', async (raw, message) => {
    renderPanel(['MaxActiveBearerCredentials']);
    expandPanel();
    const input = screen.getByRole('spinbutton', { name: /Maximum active bearer credentials/i });
    fireEvent.change(input, { target: { value: raw } });
    fireEvent.blur(input);

    expect(await screen.findByTestId('related-settings-feedback')).toHaveTextContent(message);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('shows effective values, units, bounds, provenance, and clamping in view mode', () => {
    renderPanel(['JwksFetchTimeoutMs', 'JwksFetchRetries', 'JwksCacheMaxAgeMs']);
    expandPanel();

    expect(screen.getByTestId('related-settings-effective-JwksFetchTimeoutMs')).toHaveTextContent('1200 ms');
    expect(screen.getByTestId('related-settings-source-JwksFetchTimeoutMs')).toHaveTextContent('Endpoint override');
    expect(screen.getByTestId('related-settings-bounds-JwksFetchTimeoutMs')).toHaveTextContent('100 - 60000 ms');
    expect(screen.getByTestId('related-settings-source-JwksFetchRetries')).toHaveTextContent('Server environment');
    expect(screen.getByTestId('related-settings-clamped-JwksCacheMaxAgeMs')).toHaveTextContent('90000000');
    expect(screen.getByTestId('related-settings-clamped-JwksCacheMaxAgeMs')).toHaveTextContent('60000');
  });

  it('edits and saves only changed egress overrides', async () => {
    renderPanel(['JwksFetchTimeoutMs', 'JwksFetchRetries']);
    expandPanel();
    fireEvent.click(screen.getByTestId('related-settings-egress-edit'));
    fireEvent.change(screen.getByTestId('related-settings-JwksFetchTimeoutMs-draft'), {
      target: { value: '1400' },
    });
    fireEvent.click(screen.getByTestId('related-settings-egress-save'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      profile: { settings: { JwksFetchTimeoutMs: 1400 } },
    }));
  });

  it('Cancel discards egress drafts without persisting', () => {
    renderPanel(['JwksFetchTimeoutMs']);
    expandPanel();
    fireEvent.click(screen.getByTestId('related-settings-egress-edit'));
    fireEvent.change(screen.getByTestId('related-settings-JwksFetchTimeoutMs-draft'), {
      target: { value: '1500' },
    });
    fireEvent.click(screen.getByTestId('related-settings-egress-cancel'));
    fireEvent.click(screen.getByTestId('related-settings-egress-edit'));

    expect(screen.getByTestId('related-settings-JwksFetchTimeoutMs-draft')).toHaveValue(1200);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('Reset to inherit sends null only after Save', async () => {
    renderPanel(['JwksFetchTimeoutMs']);
    expandPanel();
    fireEvent.click(screen.getByTestId('related-settings-egress-edit'));
    fireEvent.click(screen.getByTestId('related-settings-JwksFetchTimeoutMs-reset'));
    expect(mockMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('related-settings-egress-save'));

    await waitFor(() => expect(mockMutateAsync).toHaveBeenCalledWith({
      profile: { settings: { JwksFetchTimeoutMs: null } },
    }));
  });

  it('declares the intended ownership map for endpoint subtabs', () => {
    expect(TAB_SETTING_KEYS.users).toEqual(['UserSoftDeleteEnabled', 'UserHardDeleteEnabled']);
    expect(TAB_SETTING_KEYS.groups).toEqual([
      'GroupHardDeleteEnabled',
      'MultiMemberPatchOpForGroupEnabled',
      'PatchOpAllowRemoveAllMembers',
    ]);
    expect(TAB_SETTING_KEYS.schemas).toEqual(
      expect.arrayContaining(['SchemaDiscoveryEnabled', 'StrictSchemaValidation', 'RfcCompliantSubAttributes']),
    );
    expect(TAB_SETTING_KEYS.resourceTypes).toContain('EnforceResourceTypes');
    expect(TAB_SETTING_KEYS.logs).toEqual(
      expect.arrayContaining(['PersistRequestSecrets', 'logFileEnabled', 'logLevel']),
    );
    expect(TAB_SETTING_KEYS.connectWif).toEqual(
      expect.arrayContaining(['MaxActiveWifTrusts', 'JwksFetchTimeoutMs', 'JwksMaxKeys']),
    );
  });
});