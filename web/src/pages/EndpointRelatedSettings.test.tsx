import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { EndpointRelatedSettings } from './EndpointRelatedSettings';
import { TAB_SETTING_KEYS } from './endpoint-settings-definitions';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

const mockUseEndpointOverview = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: (...args: unknown[]) => mockUseEndpointOverview(...args),
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

describe('EndpointRelatedSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({});
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
  });

  it('renders boolean, enum and numeric controls from the shared registry', () => {
    renderPanel(['UserSoftDeleteEnabled', 'PrimaryEnforcement', 'MaxActiveBearerCredentials']);

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
    fireEvent.click(screen.getByRole('switch', { name: /User soft delete/i }));

    expect(await screen.findByTestId('related-settings-feedback')).toHaveTextContent(/save failed/i);
  });

  it('persists an enum selection through the same mutation path', async () => {
    renderPanel(['PrimaryEnforcement']);
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
    const input = screen.getByRole('spinbutton', { name: /Maximum active bearer credentials/i });
    fireEvent.change(input, { target: { value: raw } });
    fireEvent.blur(input);

    expect(await screen.findByTestId('related-settings-feedback')).toHaveTextContent(message);
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('declares the intended ownership map for endpoint subtabs', () => {
    expect(TAB_SETTING_KEYS.users).toEqual(
      expect.arrayContaining(['UserSoftDeleteEnabled', 'UserHardDeleteEnabled', 'PrimaryEnforcement']),
    );
    expect(TAB_SETTING_KEYS.groups).toEqual(
      expect.arrayContaining(['GroupHardDeleteEnabled', 'MultiMemberPatchOpForGroupEnabled', 'PatchOpAllowRemoveAllMembers']),
    );
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