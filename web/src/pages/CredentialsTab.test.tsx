/**
 * CredentialsTab tests (Phase E1).
 *
 * Asserts the spec contract per UI_REDESIGN_REMAINING_GAPS_PLAN.md S8.1:
 *   - Loads from useEndpointOverview (Phase B BFF, no extra round trip)
 *   - Skeleton on loading; EmptyState when zero credentials
 *   - Add credential button opens FormDialog
 *   - On create success: shows plaintext token EXACTLY ONCE with copy button
 *   - Delete row -> confirm dialog -> useDeleteCredential
 *   - 403 (PerEndpointCredentialsEnabled=False) -> warning banner +
 *     disabled create button
 *   - Mutation error -> errorMessage in dialog (no silent failure)
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { CredentialsTab } from './CredentialsTab';
import type { EndpointOverviewResponse } from '@scim/types/dashboard.types';

const mockUseEndpointOverview = vi.fn();
const mockCreateMutate = vi.fn();
const mockDeleteMutate = vi.fn();
const mockResolveMutate = vi.fn();
const mockRevealMutate = vi.fn();
const mockRotateMutate = vi.fn();
const mockAddJwksHost = vi.fn();
const mockUpdateWif = vi.fn();
const mockVerifyWif = vi.fn();
const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual('@tanstack/react-router');
  return { ...actual, useNavigate: () => mockNavigate };
});
let createMutationState = { isPending: false };
let deleteMutationState = { isPending: false };
let jwksAllowlistState: { data: { seed: string[]; env: string[]; persisted: string[]; effective: string[] } | undefined; isLoading: boolean } = {
  data: { seed: ['login.microsoftonline.com'], env: [], persisted: [], effective: ['login.microsoftonline.com'] },
  isLoading: false,
};

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useEndpointOverview: (...args: unknown[]) => mockUseEndpointOverview(...args),
    useCreateCredential: () => ({
      mutate: mockCreateMutate,
      isPending: createMutationState.isPending,
    }),
    useDeleteCredential: () => ({
      mutate: mockDeleteMutate,
      isPending: deleteMutationState.isPending,
    }),
    useResolveWifDiscovery: () => ({
      mutate: mockResolveMutate,
      isPending: false,
    }),
    useRevealCredential: () => ({
      mutate: mockRevealMutate,
      isPending: false,
    }),
    useRotateCredential: () => ({
      mutate: mockRotateMutate,
      isPending: false,
    }),
    useJwksHostAllowlist: () => jwksAllowlistState,
    useAddJwksHost: () => ({ mutate: mockAddJwksHost, isPending: false, isError: false, error: null }),
    useUpdateWifCredential: () => ({ mutate: mockUpdateWif, isPending: false }),
    useVerifyWifTrust: () => ({ mutate: mockVerifyWif, isPending: false, isError: false, error: null }),
  };
});

const baseOverview: EndpointOverviewResponse = {
  endpoint: {
    id: 'ep-1',
    name: 'prod',
    displayName: 'Production',
    preset: 'entra-id',
    active: true,
    scimBasePath: '/scim/endpoints/ep-1/v2',
    createdAt: '2026-01-01T00:00:00Z',
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
  configFlags: { PerEndpointCredentialsEnabled: true },
  connectionInfo: {
    endpointId: 'ep-1',
    displayName: 'Production',
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

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('CredentialsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMutationState = { isPending: false };
    deleteMutationState = { isPending: false };
  });

  // ─── Loading / error / empty states ────────────────────────────────

  it('shows LoadingSkeleton on isLoading', () => {
    mockUseEndpointOverview.mockReturnValue({ data: undefined, isLoading: true, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-skeleton')).toBeInTheDocument();
  });

  it('shows error block on error', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Network error'),
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-error')).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('shows EmptyState when flag enabled but no credentials exist', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-empty')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-empty-title')).toHaveTextContent(
      /No credentials configured/i,
    );
  });

  // ─── Flag-disabled banner ──────────────────────────────────────────

  it('shows warning banner and disables Add button when flag is off', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { PerEndpointCredentialsEnabled: false } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-flag-disabled-banner')).toBeInTheDocument();
    const addBtn = screen.getByTestId('credentials-create-button');
    expect(addBtn).toBeDisabled();
  });

  it('shows warning banner when flag is missing entirely (treated as off)', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: {} },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('credentials-flag-disabled-banner')).toBeInTheDocument();
  });

  // ─── List rendering ────────────────────────────────────────────────

  it('renders one card per credential', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-1',
          credentialType: 'bearer',
          label: 'Entra production',
          active: true,
          createdAt: '2026-04-01T10:00:00Z',
          expiresAt: null,
        },
        {
          id: 'cred-2',
          credentialType: 'bearer',
          label: null,
          active: false,
          createdAt: '2026-03-15T09:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    expect(screen.getByTestId('credentials-list')).toBeInTheDocument();
    expect(screen.getByTestId('credential-row-cred-1')).toBeInTheDocument();
    expect(screen.getByTestId('credential-row-cred-2')).toBeInTheDocument();
    // Active vs Revoked badges
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    // Headline shows the count
    expect(screen.getByText(/Credentials \(2\)/)).toBeInTheDocument();
  });

  // ─── Create flow ───────────────────────────────────────────────────

  it('opens create dialog when Add button clicked', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    expect(screen.getByTestId('credentials-create-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-label-input')).toBeInTheDocument();
  });

  it('passes label to mutation on Create submit', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    // Fluent UI's Input renders the actual <input> as the testid
    // element OR a child of it depending on version. Cover both.
    const inputContainer = screen.getByTestId('credentials-label-input');
    const input = inputContainer.tagName === 'INPUT'
      ? inputContainer
      : inputContainer.querySelector('input') ?? inputContainer;
    fireEvent.change(input, { target: { value: 'My new cred' } });

    // Submit by clicking the form's Create button (FormDialog Submit
    // is the primary button in the dialog footer).
    const dialog = screen.getByTestId('credentials-create-dialog');
    const submit = dialog.querySelector('button[type="submit"]');
    expect(submit).toBeTruthy();
    fireEvent.click(submit!);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    expect(mockCreateMutate.mock.calls[0][0]).toMatchObject({ label: 'My new cred' });
  });

  it('passes undefined label when input is empty (no whitespace string)', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    const submit = dialog.querySelector('button[type="submit"]');
    fireEvent.click(submit!);

    expect(mockCreateMutate.mock.calls[0][0]).toEqual({ label: undefined, credentialType: 'bearer' });
  });

  it('shows plaintext token + copy button after successful create', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    // mutate(args, opts) - we simulate the onSuccess callback firing
    // synchronously with the server's plaintext token response.
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onSuccess?.({
        id: 'new-cred-id',
        label: 'Entra prod',
        token: 'super-secret-bearer-token-123',
        createdAt: '2026-05-08T12:00:00Z',
      });
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(screen.getByTestId('credentials-plaintext')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-token-value')).toHaveTextContent(
      'super-secret-bearer-token-123',
    );
    expect(screen.getByTestId('credentials-copy-button')).toBeInTheDocument();
  });

  it('R7: creating an oauth_client shows clientId + secret + copy-as-JSON', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onSuccess?.({
        id: 'oauth-cred-id',
        label: 'oauth prod',
        clientId: 'client-id-ep-1',
        clientSecret: 'client-secret-11111111-2222-3333-4444-555555555555',
        createdAt: '2026-07-10T12:00:00Z',
      });
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    // Select the oauth_client type from the dropdown.
    const typeDropdown = screen.getByTestId('credentials-type-dropdown');
    fireEvent.click(typeDropdown.querySelector('button') ?? typeDropdown);
    fireEvent.click(screen.getByRole('option', { name: /OAuth2 client credentials/i }));
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    // R10: assert the RENDERED clientId + secret values + the JSON copy affordance.
    expect(mockCreateMutate.mock.calls[0][0]).toMatchObject({ credentialType: 'oauth_client' });
    expect(screen.getByTestId('credentials-oauth-result')).toBeInTheDocument();
    expect(screen.getByTestId('credentials-oauth-clientid')).toHaveTextContent('client-id-ep-1');
    expect(screen.getByTestId('credentials-oauth-clientsecret')).toHaveTextContent(
      'client-secret-11111111-2222-3333-4444-555555555555',
    );
    expect(screen.getByTestId('credentials-oauth-copy-json')).toBeInTheDocument();
  });

  it('R8: cross-links to the Connect tab of the same endpoint', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    mockNavigate.mockClear();
    screen.getByTestId('credentials-link-connect').click();
    expect(mockNavigate).toHaveBeenCalledWith(expect.objectContaining({ to: '/endpoints/$endpointId/connect' }));
  });

  it('surfaces mutation error in the dialog (no silent failure)', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onError?.(new Error('403 Forbidden - flag disabled on server'));
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('credentials-create-button'));
    const dialog = screen.getByTestId('credentials-create-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(screen.getByText(/403 Forbidden/)).toBeInTheDocument();
  });

  // ─── Delete flow ───────────────────────────────────────────────────

  it('opens delete confirmation when delete icon clicked', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-x',
          credentialType: 'bearer',
          label: 'Doomed',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credential-delete-cred-x'));
    expect(screen.getByTestId('credentials-delete-dialog')).toBeInTheDocument();
    // Title text is broken across nodes ("Revoke credential" + label)
    // - assert via the dialog's textContent for resilience.
    const dialog = screen.getByTestId('credentials-delete-dialog');
    expect(dialog.textContent).toContain('Doomed');
  });

  it('calls useDeleteCredential mutate on Revoke confirm', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        {
          id: 'cred-x',
          credentialType: 'bearer',
          label: 'Doomed',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.click(screen.getByTestId('credential-delete-cred-x'));
    const dialog = screen.getByTestId('credentials-delete-dialog');
    fireEvent.click(dialog.querySelector('button[type="submit"]')!);

    expect(mockDeleteMutate).toHaveBeenCalledTimes(1);
    expect(mockDeleteMutate.mock.calls[0][0]).toBe('cred-x');
  });

  // ─── WI-8: reveal ──────────────────────────────────────────────────

  it('shows a Reveal button for an active non-wif credential and calls the reveal mutation', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        { id: 'cred-r', credentialType: 'oauth_client', label: 'Revealable', active: true, createdAt: '2026-05-01T00:00:00Z', expiresAt: null },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    const revealBtn = screen.getByTestId('credential-reveal-cred-r');
    fireEvent.click(revealBtn);
    expect(mockRevealMutate).toHaveBeenCalledTimes(1);
    expect(mockRevealMutate.mock.calls[0][0]).toBe('cred-r');
  });

  it('does not show a Reveal button for a revoked credential', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        { id: 'cred-dead', credentialType: 'oauth_client', label: 'Gone', active: false, createdAt: '2026-05-01T00:00:00Z', expiresAt: null },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.queryByTestId('credential-reveal-cred-dead')).not.toBeInTheDocument();
  });

  // ─── WI-9: rotate ──────────────────────────────────────────────────

  it('shows a Rotate button for an active non-wif credential and calls the rotate mutation', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      credentials: [
        { id: 'cred-rot', credentialType: 'oauth_client', label: 'Rotatable', active: true, createdAt: '2026-05-01T00:00:00Z', expiresAt: null },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    const rotateBtn = screen.getByTestId('credential-rotate-cred-rot');
    fireEvent.click(rotateBtn);
    expect(mockRotateMutate).toHaveBeenCalledTimes(1);
    expect(mockRotateMutate.mock.calls[0][0]).toBe('cred-rot');
  });

  it('does not show a Rotate button for a wif credential', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      configFlags: { WifCredentialsEnabled: true },
      credentials: [
        { id: 'cred-wif', credentialType: 'wif', label: 'WIF trust', active: true, createdAt: '2026-05-01T00:00:00Z', expiresAt: null },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.queryByTestId('credential-rotate-cred-wif')).not.toBeInTheDocument();
  });

  it('displays the full public trust field VALUES for a configured wif trust', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      configFlags: { WifCredentialsEnabled: true },
      credentials: [
        {
          id: 'cred-wif',
          credentialType: 'wif',
          label: 'Contoso Entra',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
          wif: {
            expectedIssuer: 'https://login.microsoftonline.com/contoso/v2.0',
            expectedSubject: 'sp-object-id-123',
            expectedAudience: 'api://scim-app',
            jwksUri: 'https://login.microsoftonline.com/contoso/discovery/v2.0/keys',
            allowedTenantId: 'contoso-tenant-guid',
            requiredRoles: ['Scim.Provision', 'Scim.Read'],
            scope: 'scim.read scim.write',
            assertionProfile: 'jwt-bearer',
            issuedTokenTtlSec: null,
          },
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // R10: assert the RENDERED VALUES, not just that the row exists.
    const details = screen.getByTestId('wif-credential-details-cred-wif');
    expect(details).toBeInTheDocument();
    // Each value flows through CopyableField, whose copy button aria-label
    // carries the value; assert the value is actually present in the DOM.
    expect(screen.getByTestId('wif-credential-cred-wif-issuer').textContent).toContain(
      'https://login.microsoftonline.com/contoso/v2.0',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-subject').textContent).toContain(
      'sp-object-id-123',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-audience').textContent).toContain(
      'api://scim-app',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-jwks').textContent).toContain(
      'https://login.microsoftonline.com/contoso/discovery/v2.0/keys',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-tenant').textContent).toContain(
      'contoso-tenant-guid',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-roles').textContent).toContain(
      'Scim.Provision, Scim.Read',
    );
    expect(screen.getByTestId('wif-credential-cred-wif-scope').textContent).toContain(
      'scim.read scim.write',
    );
  });

  it('item 4: Edit loads a saved trust into the form and Save changes calls the update mutation', () => {
    mockUpdateWif.mockClear();
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      configFlags: { WifCredentialsEnabled: true },
      credentials: [
        {
          id: 'cred-edit',
          credentialType: 'wif',
          label: 'Editable trust',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
          wif: {
            expectedIssuer: 'https://old.example/v2.0',
            expectedSubject: 'old-sub',
            expectedAudience: 'old-aud',
            jwksUri: 'https://login.microsoftonline.com/t/keys',
            allowedTenantId: 'old-tid',
            requiredRoles: ['Scim.Provision'],
            scope: null,
            assertionProfile: 'jwt-bearer',
            issuedTokenTtlSec: null,
          },
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // Click Edit on the saved trust row.
    fireEvent.click(screen.getByTestId('wif-credential-edit-cred-edit'));
    // The form is now populated with the saved values (R10: assert the value).
    expect((wifInput('wif-field-issuer') as HTMLInputElement).value).toBe('https://old.example/v2.0');
    expect((wifInput('wif-field-subject') as HTMLInputElement).value).toBe('old-sub');
    expect((wifInput('wif-field-tenant') as HTMLInputElement).value).toBe('old-tid');
    // The editing banner + Save changes label appear.
    expect(screen.getByTestId('wif-editing-banner')).toBeInTheDocument();
    expect(screen.getByTestId('wif-save-button').textContent).toContain('Save changes');

    // Change the issuer and save -> update mutation fires with the credential id.
    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'https://new.example/v2.0' } });
    fireEvent.click(screen.getByTestId('wif-save-button'));
    expect(mockUpdateWif).toHaveBeenCalledTimes(1);
    const arg = mockUpdateWif.mock.calls[0][0];
    expect(arg.credentialId).toBe('cred-edit');
    expect(arg.wif.expectedIssuer).toBe('https://new.example/v2.0');
    expect(arg.wif.allowedTenantId).toBe('old-tid');
  });

  it('item 4: Cancel edit clears the form and exits edit mode', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      configFlags: { WifCredentialsEnabled: true },
      credentials: [
        {
          id: 'cred-cancel',
          credentialType: 'wif',
          label: 'Trust',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
          wif: {
            expectedIssuer: 'https://x.example/v2.0',
            expectedSubject: 'sub',
            expectedAudience: 'aud',
            jwksUri: 'https://login.microsoftonline.com/t/keys',
            allowedTenantId: 'tid',
            requiredRoles: null,
            scope: null,
            assertionProfile: 'jwt-bearer',
            issuedTokenTtlSec: null,
          },
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.click(screen.getByTestId('wif-credential-edit-cred-cancel'));
    expect((wifInput('wif-field-issuer') as HTMLInputElement).value).toBe('https://x.example/v2.0');
    fireEvent.click(screen.getByTestId('wif-cancel-edit-button'));
    // Back to create mode: form cleared, banner gone.
    expect((wifInput('wif-field-issuer') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('wif-editing-banner')).not.toBeInTheDocument();
    expect(screen.getByTestId('wif-save-button').textContent).toContain('Save WIF trust');
  });

  it('renders a dash for absent optional trust fields (stable grid shape)', () => {
    const overview: EndpointOverviewResponse = {
      ...baseOverview,
      configFlags: { WifCredentialsEnabled: true },
      credentials: [
        {
          id: 'cred-wif2',
          credentialType: 'wif',
          label: 'Minimal trust',
          active: true,
          createdAt: '2026-05-01T00:00:00Z',
          expiresAt: null,
          wif: {
            expectedIssuer: 'https://idp.example/v2.0',
            expectedSubject: 'sub-1',
            expectedAudience: 'aud-1',
            jwksUri: 'https://idp.example/keys',
            allowedTenantId: 'tid-1',
            requiredRoles: null,
            scope: null,
            assertionProfile: 'jwt-bearer',
            issuedTokenTtlSec: null,
          },
        },
      ],
    };
    mockUseEndpointOverview.mockReturnValue({ data: overview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    // Optional roles + scope absent -> dash, grid still has the rows.
    expect(screen.getByTestId('wif-credential-cred-wif2-roles').textContent).toBe('-');
    expect(screen.getByTestId('wif-credential-cred-wif2-scope').textContent).toBe('-');
    // Required issuer still shows its value.
    expect(screen.getByTestId('wif-credential-cred-wif2-issuer').textContent).toContain(
      'https://idp.example/v2.0',
    );
  });

  function wifInput(testId: string): HTMLElement {
    const root = screen.getByTestId(testId);
    return root.querySelector('input') ?? root.querySelector('textarea') ?? root;
  }

  it('shows the WIF disabled banner when WifCredentialsEnabled is off', () => {
    mockUseEndpointOverview.mockReturnValue({ data: baseOverview, isLoading: false, error: null });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('wif-section')).toBeInTheDocument();
    expect(screen.getByTestId('wif-flag-disabled-banner')).toBeInTheDocument();
    // Inputs are not rendered while disabled.
    expect(screen.queryByTestId('wif-field-issuer')).not.toBeInTheDocument();
  });

  it('renders the 4+ Entra input fields when WIF is enabled (G1)', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { PerEndpointCredentialsEnabled: true, WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    expect(screen.getByTestId('wif-field-issuer')).toBeInTheDocument();
    expect(screen.getByTestId('wif-field-subject')).toBeInTheDocument();
    expect(screen.getByTestId('wif-field-audience')).toBeInTheDocument();
    expect(screen.getByTestId('wif-field-jwks')).toBeInTheDocument();
    expect(screen.getByTestId('wif-field-tenant')).toBeInTheDocument();
    // Save is disabled until the required fields are filled.
    expect(screen.getByTestId('wif-save-button')).toBeDisabled();
    expect(screen.getByTestId('wif-copy-json')).toBeInTheDocument();
  });

  it('WI-13: shows the claim-name alias hint when WIF is enabled', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    const hint = screen.getByTestId('wif-field-alias-hint');
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toMatch(/iss/);
    expect(hint.textContent).toMatch(/expectedTenantId/);
    // The tenant field label reflects both the claim name and the alias.
    expect(screen.getByText(/tid \/ expectedTenantId/i)).toBeInTheDocument();
  });

  it('JWKS allowlist: shows the effective host list + warning with inline add when the JWKS host is not allowed', () => {
    jwksAllowlistState = {
      data: { seed: ['login.microsoftonline.com'], env: [], persisted: [], effective: ['login.microsoftonline.com'] },
      isLoading: false,
    };
    mockAddJwksHost.mockClear();
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // The allowlist is shown as relevant context (R10: assert the rendered host).
    expect(screen.getByTestId('wif-jwks-allowlist-notice')).toBeInTheDocument();
    expect(screen.getByTestId('wif-jwks-host-login.microsoftonline.com')).toBeInTheDocument();

    // Enter a JWKS URI whose host is NOT on the allowlist.
    fireEvent.change(wifInput('wif-field-jwks'), {
      target: { value: 'https://keys.okta.example/v1/keys' },
    });
    const warning = screen.getByTestId('wif-jwks-host-warning');
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).toContain('keys.okta.example');
    const addBtn = screen.getByTestId('wif-jwks-add-host');
    expect(addBtn.textContent).toContain('keys.okta.example');
    fireEvent.click(addBtn);
    expect(mockAddJwksHost).toHaveBeenCalledWith({ host: 'keys.okta.example' });
  });

  it('JWKS allowlist: shows a success note when the entered JWKS host IS allowed', () => {
    jwksAllowlistState = {
      data: { seed: ['login.microsoftonline.com'], env: [], persisted: [], effective: ['login.microsoftonline.com'] },
      isLoading: false,
    };
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.change(wifInput('wif-field-jwks'), {
      target: { value: 'https://login.microsoftonline.com/t/discovery/v2.0/keys' },
    });
    expect(screen.getByTestId('wif-jwks-host-ok')).toBeInTheDocument();
    expect(screen.queryByTestId('wif-jwks-host-warning')).not.toBeInTheDocument();
  });

  it('item 6: Verify calls the server with issuer + jwks and renders the per-check checklist', () => {
    mockVerifyWif.mockClear();
    // The mocked verify hook resolves via its onSuccess callback with a result.
    mockVerifyWif.mockImplementation(
      (_body: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
        opts?.onSuccess?.({
          ok: false,
          checks: [
            { id: 'issuerFormat', label: 'Issuer is a valid https URL', ok: true, detail: 'https://idp/v2.0' },
            { id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'GET returned HTTP 404.' },
            { id: 'jwksServesKeys', label: 'JWKS serves a non-empty key set', ok: false, detail: 'not a JWKS' },
          ],
        });
      },
    );
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'https://idp.example/v2.0' } });
    fireEvent.change(wifInput('wif-field-jwks'), { target: { value: 'https://idp.example/keys' } });
    fireEvent.click(screen.getByTestId('wif-verify-button'));

    // The mutation was called with the entered issuer + jwks.
    expect(mockVerifyWif).toHaveBeenCalledTimes(1);
    const body = mockVerifyWif.mock.calls[0][0];
    expect(body.expectedIssuer).toBe('https://idp.example/v2.0');
    expect(body.jwksUri).toBe('https://idp.example/keys');

    // R10: the rendered checklist shows each check's OUTCOME + detail.
    expect(screen.getByTestId('wif-verify-result')).toBeInTheDocument();
    expect(screen.getByTestId('wif-verify-check-issuerFormat').textContent).toContain('valid https URL');
    const jwksReach = screen.getByTestId('wif-verify-check-jwksReachable');
    expect(jwksReach.textContent).toContain('reachable');
    expect(jwksReach.textContent).toContain('404');
    expect(screen.getByTestId('wif-verify-check-jwksServesKeys')).toBeInTheDocument();
  });

  it('WI-14: the discovery resolver row is present and fires resolve with the tenant id', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    mockResolveMutate.mockClear();
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // The resolver row + tenant input + button render.
    expect(screen.getByTestId('wif-resolve-row')).toBeInTheDocument();
    const btn = screen.getByTestId('wif-resolve-button');
    // Button is disabled until a tenant id is entered.
    expect(btn).toBeDisabled();

    fireEvent.change(wifInput('wif-resolve-tenant'), { target: { value: 'tenant-guid-123' } });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);

    expect(mockResolveMutate).toHaveBeenCalledTimes(1);
    const body = mockResolveMutate.mock.calls[0][0];
    expect(body).toMatchObject({ preset: 'entra-commercial', tenantId: 'tenant-guid-123' });
  });

  it('enables Save once required fields are filled and posts a wif credential (G2)', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    mockCreateMutate.mockImplementation((_body, opts) => {
      opts?.onSuccess?.({ id: 'wif-cred-1', credentialType: 'wif' });
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'https://login.microsoftonline.com/t/v2.0' } });
    fireEvent.change(wifInput('wif-field-subject'), { target: { value: 'sp-obj-id' } });
    fireEvent.change(wifInput('wif-field-audience'), { target: { value: 'api://app' } });
    fireEvent.change(wifInput('wif-field-jwks'), { target: { value: 'https://login.microsoftonline.com/t/discovery/v2.0/keys' } });
    fireEvent.change(wifInput('wif-field-tenant'), { target: { value: 'tenant-guid' } });

    const save = screen.getByTestId('wif-save-button');
    expect(save).not.toBeDisabled();
    fireEvent.click(save);

    expect(mockCreateMutate).toHaveBeenCalledTimes(1);
    const body = mockCreateMutate.mock.calls[0][0];
    expect(body.credentialType).toBe('wif');
    expect(body.wif).toMatchObject({
      assertionProfile: 'jwt-bearer',
      expectedIssuer: 'https://login.microsoftonline.com/t/v2.0',
      expectedSubject: 'sp-obj-id',
      expectedAudience: 'api://app',
      jwksUri: 'https://login.microsoftonline.com/t/discovery/v2.0/keys',
      allowedTenantId: 'tenant-guid',
    });
    // Item C: the first save requests the server-side verify gate.
    expect(body.verify).toBe(true);

    // The 3 ISV return values render after a successful save (G2).
    expect(screen.getByTestId('wif-return-values')).toBeInTheDocument();
    expect(screen.getByTestId('wif-return-clientid')).toBeInTheDocument();
    expect(screen.getByTestId('wif-return-tokenurl')).toBeInTheDocument();
    expect(screen.getByTestId('wif-return-scimurl')).toBeInTheDocument();

    // WI-1 regression: the SCIM URL must be the spec form
    // `/scim/v2/endpoints/{id}` (the `/scim/v2` rewrite is a leading prefix),
    // NOT the buggy `/scim/endpoints/{id}/v2`. CopyableField sets the copy
    // button's aria-label deterministically to `Copy ${value}`, so assert on it.
    const scimCopyBtn = screen.getByTestId('wif-return-scimurl-copy-button');
    expect(scimCopyBtn.getAttribute('aria-label')).toContain('/scim/v2/endpoints/ep-1');
    expect(scimCopyBtn.getAttribute('aria-label')).not.toContain('/scim/endpoints/ep-1/v2');

    // WI-12: the per-endpoint RFC 8414 OAuth AS metadata URL (append form) is
    // surfaced in the return box.
    const metaCopyBtn = screen.getByTestId('wif-return-metadataurl-copy-button');
    expect(metaCopyBtn.getAttribute('aria-label')).toContain(
      '/scim/endpoints/ep-1/.well-known/oauth-authorization-server',
    );
  });

  it('item C: a 422 verify failure renders the checklist + a Save-anyway that re-saves without the gate', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    // First save (verify:true) -> the server rejects with 422 + checks.
    // Second save (verify:false, "Save anyway") -> success.
    let call = 0;
    mockCreateMutate.mockImplementation((_body, opts) => {
      call += 1;
      if (call === 1) {
        opts?.onError?.({
          status: 422,
          rawBody: {
            scimType: 'invalidValue',
            checks: [
              { id: 'jwksReachable', label: 'JWKS URI reachable', ok: false, detail: 'GET returned HTTP 404.' },
              { id: 'jwksServesKeys', label: 'JWKS serves a non-empty key set', ok: false, detail: 'not a JWKS' },
            ],
          },
        });
      } else {
        opts?.onSuccess?.({ id: 'wif-forced', credentialType: 'wif' });
      }
    });

    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'https://idp.example/v2.0' } });
    fireEvent.change(wifInput('wif-field-subject'), { target: { value: 'sub' } });
    fireEvent.change(wifInput('wif-field-audience'), { target: { value: 'aud' } });
    fireEvent.change(wifInput('wif-field-jwks'), { target: { value: 'https://idp.example/keys' } });
    fireEvent.change(wifInput('wif-field-tenant'), { target: { value: 'tid' } });

    // First save -> verify:true -> 422 -> checklist + Save-anyway appear.
    fireEvent.click(screen.getByTestId('wif-save-button'));
    expect(mockCreateMutate.mock.calls[0][0].verify).toBe(true);
    expect(screen.getByTestId('wif-verify-result')).toBeInTheDocument();
    expect(screen.getByTestId('wif-verify-check-jwksReachable').textContent).toContain('404');
    const anyway = screen.getByTestId('wif-save-anyway-button');
    expect(anyway).toBeInTheDocument();

    // Save anyway -> verify:false -> success.
    fireEvent.click(anyway);
    expect(mockCreateMutate.mock.calls[1][0].verify).toBe(false);
    expect(screen.getByTestId('wif-return-values')).toBeInTheDocument();
  });

  it('item D: shows an inline validation message for a non-https issuer/JWKS URL', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    // A non-https issuer surfaces the inline error via the Fluent Field.
    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'http://insecure/v2.0' } });
    expect(screen.getByText(/Must use https/i)).toBeInTheDocument();
    // A malformed JWKS URL surfaces the scheme hint.
    fireEvent.change(wifInput('wif-field-jwks'), { target: { value: 'not-a-url' } });
    expect(screen.getByText(/include the https:\/\/ scheme/i)).toBeInTheDocument();
  });

  it('item E: the role-enforcement dropdown sends roleEnforcement only when non-default', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    mockCreateMutate.mockClear();
    mockCreateMutate.mockImplementation((_body, opts) => opts?.onSuccess?.({ id: 'x', credentialType: 'wif' }));
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);
    fireEvent.change(wifInput('wif-field-issuer'), { target: { value: 'https://idp/v2.0' } });
    fireEvent.change(wifInput('wif-field-subject'), { target: { value: 's' } });
    fireEvent.change(wifInput('wif-field-audience'), { target: { value: 'a' } });
    fireEvent.change(wifInput('wif-field-jwks'), { target: { value: 'https://idp/keys' } });
    fireEvent.change(wifInput('wif-field-tenant'), { target: { value: 't' } });

    // Default (Advisory/off): payload omits roleEnforcement.
    fireEvent.click(screen.getByTestId('wif-save-button'));
    expect(mockCreateMutate.mock.calls[0][0].wif.roleEnforcement).toBeUndefined();

    // The dropdown control is present for opting into strict mode.
    expect(screen.getByTestId('wif-field-role-enforcement')).toBeInTheDocument();
  });

  it('Test Connection renders a per-step readiness result (G3 client-side)', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: { ...baseOverview, configFlags: { WifCredentialsEnabled: true } },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // With empty fields, Test Connection shows FAIL steps (still renders).
    fireEvent.click(screen.getByTestId('wif-test-button'));
    const result = screen.getByTestId('wif-test-result');
    expect(result).toBeInTheDocument();
    expect(result.textContent).toMatch(/Issuer provided/);
    expect(result.textContent).toMatch(/JWKS URI is https/);
  });

  it('lists existing wif credentials with a revoke control', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: {
        ...baseOverview,
        configFlags: { WifCredentialsEnabled: true },
        credentials: [
          { id: 'wif-1', credentialType: 'wif', label: 'Entra WIF', active: true, createdAt: '2026-06-01T00:00:00Z', expiresAt: null },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    expect(screen.getByTestId('wif-credential-row-wif-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wif-credential-delete-wif-1'));
    expect(mockDeleteMutate).toHaveBeenCalledWith('wif-1');
  });

  it('WI-16: shows a multi-trust header + guidance when several wif trusts exist', () => {
    mockUseEndpointOverview.mockReturnValue({
      data: {
        ...baseOverview,
        configFlags: { WifCredentialsEnabled: true },
        credentials: [
          { id: 'wif-1', credentialType: 'wif', label: 'Contoso Entra', active: true, createdAt: '2026-06-01T00:00:00Z', expiresAt: null },
          { id: 'wif-2', credentialType: 'wif', label: 'Acme Okta', active: true, createdAt: '2026-06-02T00:00:00Z', expiresAt: null },
        ],
      },
      isLoading: false,
      error: null,
    });
    renderWithProviders(<CredentialsTab endpointId="ep-1" />);

    // Both trust rows render.
    expect(screen.getByTestId('wif-credential-row-wif-1')).toBeInTheDocument();
    expect(screen.getByTestId('wif-credential-row-wif-2')).toBeInTheDocument();

    // The multi-trust header shows the count and explains simultaneous auth.
    const header = screen.getByTestId('wif-credentials-list-header');
    expect(header).toBeInTheDocument();
    expect(header.textContent).toContain('Configured federated trusts (2)');
    expect(header.textContent).toMatch(/authenticates at the same time/i);
  });
});
