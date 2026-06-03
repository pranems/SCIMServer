/**
 * DiscoveryExplorerPage tests (Phase L5).
 *
 * Asserts:
 *   1. Page renders with three sub-tabs (ServiceProviderConfig | ResourceTypes | Schemas)
 *   2. Endpoint scope picker exposes a primary + optional secondary slot
 *   3. Single-endpoint mode: each tab renders read-only data when its hook resolves
 *   4. Two-endpoint mode: Schemas tab switches to side-by-side diff view
 *   5. Diff view colors the cell red/green/grey using the diff reducer status
 *   6. Action buttons: Copy as JSON + Copy as URN (work) + Open in Workbench (disabled tooltip)
 *   7. Empty state when no endpoints exist
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { DiscoveryExplorerPage } from './DiscoveryExplorerPage';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseEndpoints = vi.fn();
const mockUseEndpointSchemas = vi.fn();
const mockUseEndpointResourceTypes = vi.fn();
const mockUseEndpointServiceProviderConfig = vi.fn();
const mockNavigate = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: () => mockUseEndpoints(),
    useEndpointSchemas: (id: string) => mockUseEndpointSchemas(id),
    useEndpointResourceTypes: (id: string) => mockUseEndpointResourceTypes(id),
    useEndpointServiceProviderConfig: (id: string) =>
      mockUseEndpointServiceProviderConfig(id),
  };
});

// Stub useNavigate so the M1-wired "Open in Workbench" button can be
// observed without mounting the full router tree.
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const sampleEndpoints = {
  totalResults: 2,
  endpoints: [
    { id: 'ep-1', name: 'prod', displayName: 'Production', active: true },
    { id: 'ep-2', name: 'staging', displayName: 'Staging', active: true },
  ],
};

const sampleSchemas = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 1,
  startIndex: 1,
  itemsPerPage: 1,
  Resources: [
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          required: true,
          mutability: 'readWrite',
          returned: 'default',
          uniqueness: 'server',
          multiValued: false,
          caseExact: false,
        },
      ],
    },
  ],
};

const sampleSchemasTighter = {
  ...sampleSchemas,
  Resources: [
    {
      id: 'urn:ietf:params:scim:schemas:core:2.0:User',
      name: 'User',
      attributes: [
        {
          name: 'userName',
          type: 'string',
          required: true,
          mutability: 'immutable', // tightened
          returned: 'default',
          uniqueness: 'global', // tightened
          multiValued: false,
          caseExact: false,
        },
      ],
    },
  ],
};

const sampleResourceTypes = {
  schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
  totalResults: 2,
  startIndex: 1,
  itemsPerPage: 2,
  Resources: [
    { id: 'User', name: 'User', endpoint: '/Users', schema: 'urn:ietf:params:scim:schemas:core:2.0:User' },
    { id: 'Group', name: 'Group', endpoint: '/Groups', schema: 'urn:ietf:params:scim:schemas:core:2.0:Group' },
  ],
};

const sampleSpc = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  patch: { supported: true },
  filter: { supported: true, maxResults: 200 },
  etag: { supported: true },
  bulk: { supported: true, maxOperations: 1000, maxPayloadSize: 1048576 },
  changePassword: { supported: false },
  sort: { supported: true },
  authenticationSchemes: [{ type: 'oauthbearertoken', primary: true }],
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

function defaultHookReturn<T>(data: T | undefined = undefined): {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  error: null;
} {
  return { data, isLoading: false, isError: false, error: null };
}

describe('DiscoveryExplorerPage (Phase L5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseEndpoints.mockReturnValue(defaultHookReturn(sampleEndpoints));
    mockUseEndpointSchemas.mockImplementation((id: string) =>
      id ? defaultHookReturn(sampleSchemas) : defaultHookReturn(undefined),
    );
    mockUseEndpointResourceTypes.mockImplementation((id: string) =>
      id ? defaultHookReturn(sampleResourceTypes) : defaultHookReturn(undefined),
    );
    mockUseEndpointServiceProviderConfig.mockImplementation((id: string) =>
      id ? defaultHookReturn(sampleSpc) : defaultHookReturn(undefined),
    );
    // Stub clipboard for copy-as-* buttons.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(() => Promise.resolve()) },
      writable: true,
      configurable: true,
    });
  });

  // ─── 1. Sub-tabs render ────────────────────────────────────────────

  it('renders the page with three sub-tabs (SPC | ResourceTypes | Schemas)', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    expect(screen.getByTestId('discovery-page')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-tab-serviceProviderConfig')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-tab-resourceTypes')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-tab-schemas')).toBeInTheDocument();
  });

  // ─── 2. Endpoint scope picker ──────────────────────────────────────

  it('renders the primary endpoint picker with one option per endpoint', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    const picker = screen.getByTestId('discovery-primary-picker');
    expect(picker).toBeInTheDocument();
    expect(screen.getByTestId('discovery-primary-option-ep-1')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-primary-option-ep-2')).toBeInTheDocument();
  });

  it('renders an empty state when no endpoints exist', () => {
    mockUseEndpoints.mockReturnValue(defaultHookReturn({ totalResults: 0, endpoints: [] }));
    renderWithProviders(<DiscoveryExplorerPage />);
    expect(screen.getByTestId('discovery-no-endpoints')).toBeInTheDocument();
  });

  it('toggles the secondary picker visible when "Compare with another" is clicked', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    expect(screen.queryByTestId('discovery-secondary-picker')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('discovery-toggle-compare'));
    expect(screen.getByTestId('discovery-secondary-picker')).toBeInTheDocument();
  });

  // ─── 3. Single-endpoint mode ───────────────────────────────────────

  it('Schemas tab in single-endpoint mode shows the picked endpoint`s schemas list', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-tab-schemas'));
    expect(screen.getByTestId('discovery-schemas-single')).toBeInTheDocument();
    // Renders one schema row with the URN visible.
    expect(
      screen.getByText('urn:ietf:params:scim:schemas:core:2.0:User'),
    ).toBeInTheDocument();
  });

  it('ResourceTypes tab in single-endpoint mode renders one row per resource type', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-tab-resourceTypes'));
    expect(screen.getByTestId('discovery-resourcetype-row-User')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-resourcetype-row-Group')).toBeInTheDocument();
  });

  // ─── Phase P1 - CopyableField on schema URNs ───────────────────────
  it('Phase P1 - schema row exposes CopyableField for the URN', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-tab-schemas'));
    expect(
      screen.getByTestId('discovery-schema-urn-urn:ietf:params:scim:schemas:core:2.0:User-copy-button'),
    ).toBeInTheDocument();
  });

  it('Phase P1 - resource type row exposes CopyableField for the schema URN', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-tab-resourceTypes'));
    expect(
      screen.getByTestId('discovery-resourcetype-schema-User-copy-button'),
    ).toBeInTheDocument();
  });

  it('ServiceProviderConfig tab in single-endpoint mode shows the SPC capability rows', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    // Default tab is SPC; click anyway to be explicit.
    fireEvent.click(screen.getByTestId('discovery-tab-serviceProviderConfig'));
    expect(screen.getByTestId('discovery-spc-row-patch')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-spc-row-bulk')).toBeInTheDocument();
    expect(screen.getByTestId('discovery-spc-row-filter')).toBeInTheDocument();
  });

  // ─── 4. Two-endpoint mode ──────────────────────────────────────────

  it('Schemas tab with two endpoints picked renders the side-by-side diff view', () => {
    // Make ep-2 return the tighter schema to assert color.
    mockUseEndpointSchemas.mockImplementation((id: string) => {
      if (id === 'ep-1') return defaultHookReturn(sampleSchemas);
      if (id === 'ep-2') return defaultHookReturn(sampleSchemasTighter);
      return defaultHookReturn(undefined);
    });

    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-toggle-compare'));
    fireEvent.click(screen.getByTestId('discovery-secondary-option-ep-2'));
    fireEvent.click(screen.getByTestId('discovery-tab-schemas'));

    expect(screen.getByTestId('discovery-schemas-diff')).toBeInTheDocument();
    // Diff row for the userName attribute exists.
    expect(
      screen.getByTestId('discovery-diff-row-urn:ietf:params:scim:schemas:core:2.0:User-userName'),
    ).toBeInTheDocument();
  });

  it('Diff cells expose data-status that mirrors the diff-reducer classification', () => {
    mockUseEndpointSchemas.mockImplementation((id: string) => {
      if (id === 'ep-1') return defaultHookReturn(sampleSchemas);
      if (id === 'ep-2') return defaultHookReturn(sampleSchemasTighter);
      return defaultHookReturn(undefined);
    });

    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    fireEvent.click(screen.getByTestId('discovery-toggle-compare'));
    fireEvent.click(screen.getByTestId('discovery-secondary-option-ep-2'));
    fireEvent.click(screen.getByTestId('discovery-tab-schemas'));

    // mutability changed readWrite -> immutable (tighten).
    const mutCell = screen.getByTestId(
      'discovery-diff-cell-urn:ietf:params:scim:schemas:core:2.0:User-userName-mutability',
    );
    expect(mutCell.getAttribute('data-status')).toBe('tighten');
    // uniqueness changed server -> global (tighten).
    const uniqCell = screen.getByTestId(
      'discovery-diff-cell-urn:ietf:params:scim:schemas:core:2.0:User-userName-uniqueness',
    );
    expect(uniqCell.getAttribute('data-status')).toBe('tighten');
    // required true == true (unchanged).
    const reqCell = screen.getByTestId(
      'discovery-diff-cell-urn:ietf:params:scim:schemas:core:2.0:User-userName-required',
    );
    expect(reqCell.getAttribute('data-status')).toBe('unchanged');
  });

  // ─── 5. Action buttons ─────────────────────────────────────────────

  it('Copy as JSON button writes the SPC JSON to clipboard when on the SPC tab', async () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    const btn = screen.getByTestId('discovery-copy-json');
    fireEvent.click(btn);
    // navigator.clipboard.writeText was called with the JSON-stringified payload.
    expect((navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    const arg = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    // Must parse as JSON and include patch.supported (a stable SPC field).
    const parsed = JSON.parse(arg);
    expect(parsed.patch?.supported).toBe(true);
  });

  it('Open in Workbench button is enabled once an endpoint is picked AND navigates to /workbench with prefill (Phase M1)', () => {
    renderWithProviders(<DiscoveryExplorerPage />);
    // Disabled before any endpoint is picked.
    const btnPre = screen.getByTestId('discovery-open-in-workbench');
    expect(btnPre).toBeDisabled();
    // Pick endpoint -> button enables.
    fireEvent.click(screen.getByTestId('discovery-primary-option-ep-1'));
    const btn = screen.getByTestId('discovery-open-in-workbench');
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    // Default tab is ServiceProviderConfig -> path uses that surface.
    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const navArg = mockNavigate.mock.calls[0][0] as { to: string; search?: { prefill?: string } };
    expect(navArg.to).toBe('/workbench');
    const prefillRaw = decodeURIComponent(navArg.search?.prefill ?? '');
    const parsed = JSON.parse(prefillRaw);
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/scim/endpoints/ep-1/ServiceProviderConfig');
  });
});
