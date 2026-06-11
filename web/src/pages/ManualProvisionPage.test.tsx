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
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ManualProvisionPage } from './ManualProvisionPage';
import type { EndpointListResponse } from '@scim/types/dashboard.types';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoints: vi.fn(),
    useCreateUser: vi.fn(),
    useCreateGroup: vi.fn(),
  };
});

import { useEndpoints, useCreateUser, useCreateGroup } from '../api/queries';

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

  beforeEach(() => {
    vi.clearAllMocks();
    createUser = vi.fn().mockResolvedValue({ id: 'new-user-id', userName: 'alice@x.com' });
    createGroup = vi.fn().mockResolvedValue({ id: 'new-group-id', displayName: 'Engineering' });
    (useCreateUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createUser, isPending: false, error: null,
    });
    (useCreateGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: createGroup, isPending: false, error: null,
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

  it('disables the form until an endpoint is selected', () => {
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    const submit = screen.getByRole('button', { name: /Create User/i });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
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
    const userNameInput = screen.getByLabelText(/userName/i);
    await user.type(userNameInput, 'alice@x.com');

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

    const displayNameInput = screen.getByLabelText(/displayName/i);
    await user.type(displayNameInput, 'Engineering');

    await user.click(screen.getByRole('button', { name: /Create Group/i }));

    expect(useCreateGroup as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ep-2');
    expect(createGroup).toHaveBeenCalledTimes(1);
    const body = createGroup.mock.calls[0][0] as Record<string, unknown>;
    expect(body.displayName).toBe('Engineering');
    expect(Array.isArray(body.schemas)).toBe(true);
    expect((body.schemas as string[])[0]).toContain('urn:ietf:params:scim:schemas:core:2.0:Group');
  });

  it('shows ProvisionResult panel with returned id after a successful User create', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    await user.type(screen.getByLabelText(/userName/i), 'alice@x.com');
    await user.click(screen.getByRole('button', { name: /Create User/i }));

    await waitFor(() => {
      expect(screen.getByTestId('provision-result-success')).toBeInTheDocument();
    });
    // The new id appears both in the success header and in the JSON dump.
    expect(screen.getAllByText(/new-user-id/).length).toBeGreaterThanOrEqual(1);
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
    await user.type(screen.getByLabelText(/userName/i), 'alice@x.com');
    await user.click(screen.getByRole('button', { name: /Create User/i }));

    await waitFor(() => {
      expect(screen.getByTestId('provision-result-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });

  it('refuses to submit when userName is empty (HTML5 required attribute)', async () => {
    const user = userEvent.setup();
    (useEndpoints as ReturnType<typeof vi.fn>).mockReturnValue({
      data: ENDPOINTS, isLoading: false, error: null,
    });
    wrap(<ManualProvisionPage />);
    await user.click(screen.getByRole('combobox', { name: /Target endpoint/i }));
    await user.click(await screen.findByRole('option', { name: /Production/i }));
    await user.click(screen.getByRole('button', { name: /Create User/i }));
    expect(createUser).not.toHaveBeenCalled();
  });
});
