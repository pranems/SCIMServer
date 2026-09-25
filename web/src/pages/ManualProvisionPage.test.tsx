/**
 * ManualProvisionPage tests (Phase E3 - manual provisioning redesigned).
 *
 * Validates the new top-level /manual-provision page that replaces the
 * legacy components/manual/ManualProvision form. The page shouldhandle:
 *
 *   1. Endpoint Combobox sourced from useEndpoints (must select before
 *      forms become interactive).
 *   2. Resource type tabs: User and Group.
 *   3. CreateUserForm / CreateGroupForm gated behind endpoint pick;
 *      submits build a SCIM-shaped body and call useCreateUser /
 *      useCreateGroup respectively.
 *   4. ProvisionResult panel showing the created resource id + JSON
 *      payload; failure state shows the error message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ManualProvisionPage } from './ManualProvisionPage';
import type { EndpointListResponse } from '@scim/types/dashboard.types';

const routerMock = vi.hoisted(() => ({
  initialSearch: {} as Record<string, unknown>,
  setSearch: undefined as React.Dispatch<React.SetStateAction<Record<string, unknown>>> | undefined,
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router');
  const react = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useSearch: () => {
      const [search, setSearch] = react.useState(routerMock.initialSearch);
      routerMock.setSearch = setSearch;
      return search;
    },
    useNavigate: () => (options: {
      search?: Record<string, unknown> | ((previous: Record<string, unknown>) => Record<string, unknown>);
    }) => {
      routerMock.navigate(options);
      if (!options.search) return;
      routerMock.setSearch?.((previous) =>
        typeof options.search === 'function' ? options.search(previous) : options.search ?? previous,
      );
    },
  };
});

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: vi.fn(),
    useCreateUser: vi.fn(),
    useCreateGroup: vi.fn(),
    useEndpointSchemas: vi.fn(),
    useEndpointResourceTypes: vi.fn(),
    useCreateResource: vi.fn(),
  };
});

import {
  useCreateGroup,
  useCreateResource,
  useCreateUser,
  useEndpointResourceTypes,
  useEndpointSchemas,
  useEndpoints,
} from '../api/queries';

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
    {
      id: 'ep-1', name: 'prod', displayName: 'Production', active: true,
      scimBasePath: '/scim/endpoints/ep-1/v2', createdAt: '', updatedAt: '',
      _links: { self: '', stats: '', credentials: '', scim: '' },
    },
    {
      id: 'ep-2', name: 'staging', displayName: 'Staging', active: true,
      scimBasePath: '/scim/endpoints/ep-2/v2', createdAt: '', updatedAt: '',
      _links: { self: '', stats: '', credentials: '', scim: '' },
    },
  ],
};

describe('ManualProvisionPage', () => {
  let createUser: ReturnType<typeof vi.fn>;
  let createGroup: ReturnType<typeof vi.fn>;
  let createResource: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    routerMock.initialSearch = {};
    createUser = vi.fn().mockResolvedValue({ id: 'new-user-id', userName: 'alice@x.com' });
    createGroup = vi.fn().mockResolvedValue({ id: 'new-group-id', displayName: 'Engineering' });
    createResource = vi.fn().mockResolvedValue({ id: 'device-1', serialNumber: 'serial-number-example' });
    (useCreateUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createUser, isPending: false, error: null,
    });
    (useCreateGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createGroup, isPending: false, error: null,
    });
    (useCreateResource as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createResource, isPending: false, error: null,
    });
    (useEndpointSchemas as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [
          {
            id: 'urn:ietf:params:scim:schemas:core:2.0:User',
            attributes: [
              { name: 'userName', type: 'string', required: true },
              { name: 'active', type: 'boolean' },
            ],
          },
          {
            id: 'urn:ietf:params:scim:schemas:core:2.0:Group',
            attributes: [{ name: 'displayName', type: 'string', required: true }],
          },
          {
            id: 'urn:example:schemas:Device',
            attributes: [
              { name: 'serialNumber', type: 'string', required: true },
              { name: 'compliant', type: 'boolean' },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
    });
    (useEndpointResourceTypes as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        Resources: [
          {
            id: 'User', name: 'User', endpoint: '/Users',
            schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
          },
          {
            id: 'Group', name: 'Group', endpoint: '/Groups',
            schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
          },
          {
            id: 'Device', name: 'Device', endpoint: '/Devices',
            schema: 'urn:example:schemas:Device',
          },
        ],
      },
      isLoading: false,
      error: null,
    });
  });

  it('shows loading state while endpoints load', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: true, error: null,
    });
    wrap(<ManualProvisionPage />);
    expect(screen.getByTestId('manual-provision-loading')).toBeInTheDocument();
  });

  it('shows error state when the endpoints fetch fails', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: undefined, isLoading: false, error: new Error('boom'),
    });
    wrap(<ManualProvisionPage />);
    expect(screen.getByTestId('manual-provision-error')).toBeInTheDocument();
  });

  it('renders an endpoint Combobox with every endpoint as an option', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    const cb = screen.getByRole('combobox', { name: /Target endpoint/i });
    expect(cb).toBeInTheDocument();
    await user.click(cb);
    expect(await screen.findByRole('option', { name: /Production/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Staging/i })).toBeInTheDocument();
  });

  it('explains when to use the cross-endpoint workspace instead of endpoint-local Create', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    expect(screen.getByText(/Cross-endpoint creation workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/use that endpoint's Users, Groups, or custom resource tab instead/i)).toBeInTheDocument();
  });

  it('disables the form until an endpoint is selected', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    const submit = screen.getByRole('button', { name: /Create User/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
  });

  it('fails closed for a stale endpoint id from a copied URL', () => {
    routerMock.initialSearch = { endpointId: 'deleted-endpoint' };
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);

    expect(useEndpointSchemas).toHaveBeenLastCalledWith('');
    expect(useCreateUser).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('manual-provision-stale-endpoint')).toBeInTheDocument();
  });

  it('fails closed for an inactive endpoint id from a copied URL', () => {
    routerMock.initialSearch = { endpointId: 'ep-1' };
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        ...ENDPOINTS,
        endpoints: ENDPOINTS.endpoints.map((endpoint) =>
          endpoint.id === 'ep-1' ? { ...endpoint, active: false } : endpoint),
      },
      isLoading: false,
      error: null,
    });
    wrap(<ManualProvisionPage />);

    expect(useEndpointResourceTypes).toHaveBeenLastCalledWith('');
    expect(useCreateGroup).toHaveBeenLastCalledWith('');
    expect(screen.getByTestId('manual-provision-inactive-endpoint')).toBeInTheDocument();
  });

  it('submits a User create with the SCIM body shape after picking endpoint + filling userName', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);

    // Pick first endpoint.
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));

    // Fill user form.
    fireEvent.change(screen.getByTestId('manual-resource-form-userName-input'), {
      target: { value: 'alice@x.com' },
    });

    // Submit.
    await user.click(screen.getByRole('button', { name: /Create User/i }));

    expect(useCreateUser as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ep-1');
    expect(createUser).toHaveBeenCalledTimes(1);
    const body = createUser.mock.calls[0][0] as Record<string, unknown>;
    expect(body.userName).toBe('alice@x.com');
    expect(Array.isArray(body.schemas)).toBe(true);
    expect((body.schemas as string[])[0]).toContain('urn:ietf:params:scim:schemas:core:2.0:User');
    expect(body.active).toBe(true);
  });

  it('switches to the Group tab and submits a Group create with the SCIM body shape', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);

    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Staging/i }));

    // Switch to Group tab.
    await user.click(screen.getByRole('tab', { name: /Group/i }));

    fireEvent.change(screen.getByTestId('manual-resource-form-displayName-input'), {
      target: { value: 'Engineering' },
    });

    await user.click(screen.getByRole('button', { name: /Create Group/i }));

    expect(useCreateGroup as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ep-2');
    expect(createGroup).toHaveBeenCalledTimes(1);
    const body = createGroup.mock.calls[0][0] as Record<string, unknown>;
    expect(body.displayName).toBe('Engineering');
    expect(Array.isArray(body.schemas)).toBe(true);
    expect((body.schemas as string[])[0]).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
  });

  it('renders and submits a discovered custom ResourceType with the shared profile form', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);

    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    await user.click(await screen.findByRole('tab', { name: /Device/i }));

    expect(screen.getByTestId('manual-resource-form-serialNumber-input')).toHaveValue(
      'serial-number-example',
    );
    await user.click(screen.getByRole('button', { name: /Create Device/i }));

    await waitFor(() => {
      expect(useCreateResource).toHaveBeenCalledWith('ep-1', '/Devices');
      expect(createResource).toHaveBeenCalledWith({
        schemas: ['urn:example:schemas:Device'],
        serialNumber: 'serial-number-example',
        compliant: true,
      });
    });
  });

  it('switches to the newly selected endpoint resource types without retaining the old custom type', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    (useEndpointResourceTypes as ReturnType<typeof vi.fn>).mockImplementation((endpointId: string) => ({
      data: {
        Resources: endpointId === 'ep-1'
          ? [{ id: 'Device', name: 'Device', endpoint: '/Devices', schema: 'urn:example:schemas:Device' }]
          : endpointId === 'ep-2'
            ? [{
                id: 'Group', name: 'Group', endpoint: '/Groups',
                schema: 'urn:ietf:params:scim:schemas:core:2.0:Group',
              }]
            : [],
      },
      isLoading: false,
      error: null,
    }));

    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    expect(await screen.findByRole('tab', { name: 'Device' })).toHaveAttribute('aria-selected', 'true');

    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Staging/i }));
    expect(screen.queryByRole('tab', { name: 'Device' })).not.toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Group' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('manual-resource-form-displayName-input')).toHaveValue('Group Example');
  });

  it('shows ProvisionResult panel with returned id after a successful User create', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    await user.click(screen.getByRole('button', { name: /Create User/i }));

    await waitFor(() => {
      expect(screen.getByTestId('provision-result-success')).toBeInTheDocument();
    });
    // The new id appears both in the success header and in the JSON dump.
    expect(screen.getAllByText(/new-user-id/).length).toBeGreaterThanOrEqual(1);
    await user.click(screen.getByTestId('provision-open-resource'));
    expect(routerMock.navigate).toHaveBeenCalledWith({
      to: '/endpoints/$endpointId/users',
      params: { endpointId: 'ep-1' },
      search: { page: 1, detail: 'new-user-id' },
    });
  });

  it('shows error feedback in the result panel when the mutation rejects', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    createUser.mockRejectedValueOnce(new Error('HTTP 409 conflict'));
    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    await user.click(screen.getByRole('button', { name: /Create User/i }));

    await waitFor(() => {
      expect(screen.getByTestId('provision-result-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });

  it('refuses to submit when the generated required userName field is empty', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    fireEvent.change(screen.getByTestId('manual-resource-form-userName-input'), {
      target: { value: '' },
    });
    await user.click(screen.getByRole('button', { name: /Create User/i }));
    expect(createUser).not.toHaveBeenCalled();
  });
});
