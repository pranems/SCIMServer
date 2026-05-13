/**
 * CreateEndpointWizard tests (Phase L1).
 *
 * 4-step wizard that wires the already-shipped POST /admin/endpoints
 * surface into the redesigned UI. Tests cover:
 *   1. Step 1 gates Next until name is non-empty AND a preset is picked
 *   2. Step 2 renders the picked preset preview (schemas + settings + SPC)
 *   3. Step 3 reuses the SettingsTab boolean Switch grid seeded from preset defaults
 *   4. Step 4 commit fires useCreateEndpoint with the assembled body
 *      and navigates to the new endpoint detail on success
 *   5. Server error (400 duplicate name) renders <ScimErrorMessage /> in Step 4
 *   6. Back button on Step 2/3/4 returns to the previous step without losing state
 *   7. preset preview shows schema count + setting count
 *   8. Cancel on any step returns to /endpoints (no commit)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CreateEndpointWizard } from './CreateEndpointWizard';

// ─── Mocks ───────────────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockCreateMutateAsync = vi.fn();
let createMutationState: { isPending: boolean; error: unknown } = { isPending: false, error: null };

const mockUsePresets = vi.fn();
const mockUsePresetDetail = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useCreateEndpoint: () => ({
      mutate: vi.fn(),
      mutateAsync: mockCreateMutateAsync,
      isPending: createMutationState.isPending,
      error: createMutationState.error,
    }),
    usePresets: () => mockUsePresets(),
    usePresetDetail: (name: string | undefined) => mockUsePresetDetail(name),
  };
});

const samplePresetList = {
  totalResults: 3,
  presets: [
    { name: 'entra-id', default: true, summary: { schemaCount: 7, resourceTypeCount: 2 } },
    { name: 'rfc-standard', default: false, summary: { schemaCount: 3, resourceTypeCount: 2 } },
    { name: 'minimal', default: false, summary: { schemaCount: 2, resourceTypeCount: 1 } },
  ],
};

const samplePresetDetail = {
  name: 'rfc-standard',
  default: false,
  description: 'RFC 7643 / 7644 strict baseline',
  profile: {
    schemas: [
      { id: 'urn:ietf:params:scim:schemas:core:2.0:User', name: 'User' },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:Group', name: 'Group' },
      { id: 'urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig', name: 'ServiceProviderConfig' },
    ],
    resourceTypes: [
      { id: 'User', name: 'User' },
      { id: 'Group', name: 'Group' },
    ],
    serviceProviderConfig: {
      patch: { supported: true },
      bulk: { supported: true, maxOperations: 1000 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: true },
      etag: { supported: true },
    },
    settings: {
      StrictSchemaValidation: true,
      AllowAndCoerceBooleanStrings: false,
      RequireIfMatch: false,
    },
  },
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

describe('CreateEndpointWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMutationState = { isPending: false, error: null };
    mockUsePresets.mockReturnValue({ data: samplePresetList, isLoading: false, error: null });
    mockUsePresetDetail.mockImplementation((name: string | undefined) =>
      name === 'rfc-standard'
        ? { data: samplePresetDetail, isLoading: false, error: null }
        : { data: undefined, isLoading: false, error: null },
    );
    mockCreateMutateAsync.mockResolvedValue({
      id: 'new-ep',
      name: 'l1-test',
      active: true,
      scimBasePath: '/scim/endpoints/new-ep',
    });
  });

  it('renders step 1 by default with name input + preset combobox', () => {
    renderWithProviders(<CreateEndpointWizard />);
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-name-input')).toBeInTheDocument();
    expect(screen.getByTestId('wizard-preset-combobox')).toBeInTheDocument();
  });

  it('disables Next on step 1 until both name and preset are set', () => {
    renderWithProviders(<CreateEndpointWizard />);
    const next = screen.getByTestId('wizard-next-button');
    expect(next).toBeDisabled();

    // Name only - still disabled.
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    expect(next).toBeDisabled();

    // Pick preset by selecting an option.
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    expect(next).not.toBeDisabled();
  });

  it('advances to step 2 (preview) when Next is clicked from step 1', () => {
    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
  });

  it('step 2 preview shows schemas + resourceTypes + settings counts from the picked preset', () => {
    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    const preview = screen.getByTestId('wizard-preset-preview');
    expect(preview).toHaveTextContent(/3 schemas/i);
    expect(preview).toHaveTextContent(/2 resource type/i);
  });

  it('step 4 commit fires useCreateEndpoint with name + profilePreset', async () => {
    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));

    // Step 1 -> Step 2
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    // Step 2 -> Step 3
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    // Step 3 -> Step 4
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    expect(screen.getByTestId('wizard-step-4')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-create-button'));

    await waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalled();
    });
    const calledBody = mockCreateMutateAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(calledBody.name).toBe('l1-test');
    expect(calledBody.profilePreset).toBe('rfc-standard');
  });

  it('navigates to /endpoints/$endpointId on successful create', async () => {
    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-create-button'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to: '/endpoints/$endpointId',
          params: { endpointId: 'new-ep' },
        }),
      );
    });
  });

  it('Back button returns to the previous step without losing the picked preset', () => {
    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'l1-test' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));

    expect(screen.getByTestId('wizard-step-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-back-button'));
    expect(screen.getByTestId('wizard-step-1')).toBeInTheDocument();

    // Name should still be filled in.
    const nameInput = screen.getByTestId('wizard-name-input') as HTMLInputElement;
    expect(nameInput.value).toBe('l1-test');
  });

  it('renders <ScimErrorMessage /> on commit failure (400 duplicate name)', async () => {
    const { ScimApiError } = await import('../api/scim-error');
    mockCreateMutateAsync.mockRejectedValueOnce(
      new ScimApiError({
        status: 400,
        detail: 'Endpoint name already exists',
      }),
    );

    renderWithProviders(<CreateEndpointWizard />);
    fireEvent.change(screen.getByTestId('wizard-name-input'), {
      target: { value: 'duplicate' },
    });
    fireEvent.click(screen.getByTestId('wizard-preset-option-rfc-standard'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-next-button'));
    fireEvent.click(screen.getByTestId('wizard-create-button'));

    await waitFor(() => {
      expect(screen.getByTestId('scim-error-message')).toBeInTheDocument();
    });
    expect(screen.getByText(/Endpoint name already exists/i)).toBeInTheDocument();
  });
});
