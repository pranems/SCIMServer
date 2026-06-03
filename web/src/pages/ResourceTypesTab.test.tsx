/**
 * ResourceTypesTab tests (Phase M3).
 *
 * Asserts:
 *   1. Page renders with title + Create button
 *   2. CustomResourceTypesEnabled=false -> shows feature-disabled panel
 *      with link to Settings (no Create button)
 *   3. CustomResourceTypesEnabled=true with no custom RTs -> EmptyState
 *      with "Create your first custom resource type" CTA
 *   4. Lists existing custom RTs (excludes built-in User and Group)
 *   5. Each row shows name + endpoint + schema URN
 *   6. Click Create opens dialog with name + endpoint + schema URN +
 *      description fields
 *   7. Submit Create fires useUpdateEndpointConfig with the merged
 *      profile.resourceTypes[] AND profile.schemas[] arrays
 *   8. Reserved name (User/Group) shows inline validation error;
 *      Create button disabled
 *   9. Reserved endpoint (/Users/Groups/Schemas/...) shows inline error
 *  10. Click Delete opens type-name-to-confirm modal; Delete button
 *      enables only on exact name match
 *  11. Submit Delete fires PATCH with the filtered resourceTypes[]
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ResourceTypesTab } from './ResourceTypesTab';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockUseEndpoint = vi.fn();
const mockUpdateMutate = vi.fn();
let updatePending = false;

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpoint: (id: string) => mockUseEndpoint(id),
    useUpdateEndpointConfig: () => ({
      mutate: vi.fn(),
      mutateAsync: mockUpdateMutate,
      isPending: updatePending,
    }),
  };
});

const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
const SCHEMA_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
const SCHEMA_DEVICE = 'urn:ietf:params:scim:schemas:custom:Device';

function endpointWithFlag(flagOn: boolean, customRts: Array<Record<string, unknown>> = []) {
  return {
    id: 'ep-1',
    name: 'prod',
    displayName: 'Production',
    active: true,
    profile: {
      settings: {
        CustomResourceTypesEnabled: flagOn ? 'True' : 'False',
      },
      schemas: [
        { id: SCHEMA_USER, name: 'User', attributes: [] },
        { id: SCHEMA_GROUP, name: 'Group', attributes: [] },
      ],
      resourceTypes: [
        { id: 'User', name: 'User', endpoint: '/Users', schema: SCHEMA_USER, schemaExtensions: [] },
        { id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCHEMA_GROUP, schemaExtensions: [] },
        ...customRts,
      ],
    },
  };
}

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

describe('ResourceTypesTab (Phase M3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatePending = false;
    mockUseEndpoint.mockReturnValue({
      data: endpointWithFlag(true),
      isLoading: false,
      isError: false,
      error: null,
    });
    mockUpdateMutate.mockResolvedValue({});
  });

  // ─── 1-2. Flag gating ─────────────────────────────────────────────

  it('renders with title and Create button when flag is on', () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    expect(screen.getByTestId('resource-types-tab')).toBeInTheDocument();
    expect(screen.getByTestId('resource-types-create-button')).toBeInTheDocument();
  });

  it('shows feature-disabled panel + no Create button when CustomResourceTypesEnabled=false', () => {
    mockUseEndpoint.mockReturnValue({
      data: endpointWithFlag(false),
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    expect(screen.getByTestId('resource-types-disabled-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('resource-types-create-button')).not.toBeInTheDocument();
  });

  // ─── 3-5. List rendering ──────────────────────────────────────────

  it('shows EmptyState when no custom RTs exist (built-ins are excluded from the list)', () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    expect(screen.getByTestId('resource-types-empty')).toBeInTheDocument();
  });

  it('lists custom RTs (User and Group are filtered out)', () => {
    mockUseEndpoint.mockReturnValue({
      data: endpointWithFlag(true, [
        { id: 'Device', name: 'Device', endpoint: '/Devices', schema: SCHEMA_DEVICE, schemaExtensions: [] },
        { id: 'Sensor', name: 'Sensor', endpoint: '/Sensors', schema: 'urn:ietf:params:scim:schemas:custom:Sensor', schemaExtensions: [] },
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    expect(screen.getByTestId('resource-types-row-Device')).toBeInTheDocument();
    expect(screen.getByTestId('resource-types-row-Sensor')).toBeInTheDocument();
    // Built-ins NOT in the list.
    expect(screen.queryByTestId('resource-types-row-User')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resource-types-row-Group')).not.toBeInTheDocument();
    // Row content includes endpoint + schema.
    const deviceRow = screen.getByTestId('resource-types-row-Device');
    expect(deviceRow.textContent).toContain('/Devices');
    expect(deviceRow.textContent).toContain(SCHEMA_DEVICE);
  });

  // ─── 6-7. Create dialog + submit ──────────────────────────────────

  it('Create dialog renders the 4 input fields', () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('resource-types-create-button'));
    expect(screen.getByTestId('resource-types-create-name')).toBeInTheDocument();
    expect(screen.getByTestId('resource-types-create-endpoint')).toBeInTheDocument();
    expect(screen.getByTestId('resource-types-create-schema')).toBeInTheDocument();
    expect(screen.getByTestId('resource-types-create-description')).toBeInTheDocument();
  });

  it('Submit Create PATCHes the endpoint with the merged profile.resourceTypes + profile.schemas arrays', async () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('resource-types-create-button'));
    fireEvent.change(screen.getByTestId('resource-types-create-name'), { target: { value: 'Device' } });
    fireEvent.change(screen.getByTestId('resource-types-create-endpoint'), { target: { value: '/Devices' } });
    fireEvent.change(screen.getByTestId('resource-types-create-schema'), { target: { value: SCHEMA_DEVICE } });
    fireEvent.change(screen.getByTestId('resource-types-create-description'), { target: { value: 'Custom Device' } });

    fireEvent.click(screen.getByTestId('resource-types-create-dialog-submit'));

    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    const body = mockUpdateMutate.mock.calls[0][0] as {
      profile: { resourceTypes: Array<{ name: string }>; schemas: Array<{ id: string }> };
    };
    // resourceTypes carries User + Group (existing) + Device (new).
    const rtNames = body.profile.resourceTypes.map((r) => r.name).sort();
    expect(rtNames).toEqual(['Device', 'Group', 'User']);
    // schemas carries the 2 existing core URNs + the new Device URN.
    const schemaIds = body.profile.schemas.map((s) => s.id);
    expect(schemaIds).toContain(SCHEMA_DEVICE);
    expect(schemaIds).toContain(SCHEMA_USER);
  });

  // ─── 8-9. Validation ──────────────────────────────────────────────

  it('reserved name (User) shows inline error and disables Create submit', () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('resource-types-create-button'));
    fireEvent.change(screen.getByTestId('resource-types-create-name'), { target: { value: 'User' } });
    fireEvent.change(screen.getByTestId('resource-types-create-endpoint'), { target: { value: '/Foo' } });
    fireEvent.change(screen.getByTestId('resource-types-create-schema'), { target: { value: 'urn:x' } });
    expect(screen.getByTestId('resource-types-create-name-error')).toBeInTheDocument();
    expect((screen.getByTestId('resource-types-create-dialog-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reserved endpoint (/Users) shows inline error', () => {
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('resource-types-create-button'));
    fireEvent.change(screen.getByTestId('resource-types-create-name'), { target: { value: 'Foo' } });
    fireEvent.change(screen.getByTestId('resource-types-create-endpoint'), { target: { value: '/Users' } });
    expect(screen.getByTestId('resource-types-create-endpoint-error')).toBeInTheDocument();
  });

  // ─── 10-11. Delete confirm ────────────────────────────────────────

  it('Delete opens a type-name-to-confirm modal; submit fires PATCH with filtered RTs', async () => {
    mockUseEndpoint.mockReturnValue({
      data: endpointWithFlag(true, [
        { id: 'Device', name: 'Device', endpoint: '/Devices', schema: SCHEMA_DEVICE, schemaExtensions: [] },
      ]),
      isLoading: false,
      isError: false,
      error: null,
    });
    renderWithProviders(<ResourceTypesTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('resource-types-row-Device-delete'));
    expect(screen.getByTestId('resource-types-delete-dialog')).toBeInTheDocument();
    // Submit disabled until the operator types the exact name.
    const submit = screen.getByTestId('resource-types-delete-dialog-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('resource-types-delete-confirm'), { target: { value: 'Device' } });
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    await waitFor(() => expect(mockUpdateMutate).toHaveBeenCalledTimes(1));
    const body = mockUpdateMutate.mock.calls[0][0] as {
      profile: { resourceTypes: Array<{ name: string }> };
    };
    // Device removed; User and Group remain.
    const names = body.profile.resourceTypes.map((r) => r.name).sort();
    expect(names).toEqual(['Group', 'User']);
  });
});
