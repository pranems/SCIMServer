/**
 * OnboardingWizard tests (Phase N2).
 *
 * 4-step first-run wizard that walks an operator through:
 *   1. Welcome  -> Get started / Skip
 *   2. Pick preset (entra-id default)
 *   3. Issue first credential (one-click, plaintext-token-once UX)
 *   4. Send first request via Workbench deep-link
 *
 * Trigger logic:
 *   - localStorage `scimserver.onboarding.completedAt` absent
 *     AND endpoints.totalResults === 0
 *   - OR force-open flag `scimserver.onboarding.forceOpen === '1'`
 *     (test/demo escape hatch)
 *
 * Dismissed at any step writes completedAt + dispatches the change event
 * so the gate hook re-evaluates and hides the wizard.
 *
 * Test coverage (14 tests, +14 web vitest):
 *   1. Hidden when completedAt set (even with 0 endpoints)
 *   2. Hidden when totalResults > 0 (even with no completedAt)
 *   3. Shown when completedAt absent AND totalResults === 0
 *   4. Shown when force-open flag set (overrides both gates)
 *   5. Step 1 Skip writes completedAt and hides the wizard
 *   6. Step 1 Get started advances to step 2
 *   7. Step 2 entra-id is preselected
 *   8. Step 2 click another card swaps the picked preset
 *   9. Step 2 Next fires useCreateEndpoint with picked preset and advances
 *  10. Step 3 Issue credential fires useCreateCredential with new endpointId
 *  11. Step 3 plaintext token rendered in copy box after success
 *  12. Step 4 Send it now navigates to /workbench with prefill shape
 *  13. Step 4 I will do this later writes completedAt and hides
 *  14. Close (X) at any step writes completedAt
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { OnboardingWizard } from './OnboardingWizard';
import { ONBOARDING_COMPLETED_KEY, ONBOARDING_FORCE_OPEN_KEY } from '../hooks/useOnboarding';

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

const mockCreateEndpointAsync = vi.fn();
const mockCreateCredentialAsync = vi.fn();
const mockUsePresets = vi.fn();
const mockUseEndpoints = vi.fn();

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    usePresets: () => mockUsePresets(),
    useEndpoints: () => mockUseEndpoints(),
    useCreateEndpoint: () => ({
      mutate: vi.fn(),
      mutateAsync: mockCreateEndpointAsync,
      isPending: false,
      error: null,
    }),
    useCreateCredential: (_endpointId: string) => ({
      mutate: vi.fn(),
      mutateAsync: mockCreateCredentialAsync,
      isPending: false,
      error: null,
    }),
  };
});

const samplePresets = {
  totalResults: 3,
  presets: [
    { name: 'entra-id', default: true, summary: { schemaCount: 7, resourceTypeCount: 2 } },
    { name: 'rfc-standard', default: false, summary: { schemaCount: 3, resourceTypeCount: 2 } },
    { name: 'minimal', default: false, summary: { schemaCount: 2, resourceTypeCount: 1 } },
  ],
};

function renderWizard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>
        <OnboardingWizard />
      </FluentProvider>
    </QueryClientProvider>,
  );
}

describe('OnboardingWizard trigger logic (Phase N2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePresets.mockReturnValue({ data: samplePresets, isLoading: false, error: null });
    mockUseEndpoints.mockReturnValue({
      data: { totalResults: 0, endpoints: [] },
      isLoading: false,
      error: null,
    });
    mockCreateEndpointAsync.mockResolvedValue({
      id: 'new-ep',
      name: 'first-endpoint',
      active: true,
      scimBasePath: '/scim/endpoints/new-ep',
    });
    mockCreateCredentialAsync.mockResolvedValue({
      id: 'cred-1',
      label: 'onboarding-first',
      token: 'plaintext-bearer-abc123',
      createdAt: new Date().toISOString(),
    });
  });

  it('is hidden when completedAt flag is set in localStorage', () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, new Date().toISOString());
    renderWizard();
    expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
  });

  it('is hidden when endpoints.totalResults > 0', () => {
    mockUseEndpoints.mockReturnValue({
      data: { totalResults: 1, endpoints: [{ id: 'pre-existing' }] },
      isLoading: false,
      error: null,
    });
    renderWizard();
    expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
  });

  it('is shown when completedAt absent AND endpoints.totalResults === 0', () => {
    renderWizard();
    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument();
  });

  it('is shown when force-open flag is set (overrides both gates)', () => {
    localStorage.setItem(ONBOARDING_COMPLETED_KEY, new Date().toISOString());
    localStorage.setItem(ONBOARDING_FORCE_OPEN_KEY, '1');
    mockUseEndpoints.mockReturnValue({
      data: { totalResults: 5, endpoints: [] },
      isLoading: false,
      error: null,
    });
    renderWizard();
    expect(screen.getByTestId('onboarding-wizard')).toBeInTheDocument();
  });
});

describe('OnboardingWizard step transitions (Phase N2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockUsePresets.mockReturnValue({ data: samplePresets, isLoading: false, error: null });
    mockUseEndpoints.mockReturnValue({
      data: { totalResults: 0, endpoints: [] },
      isLoading: false,
      error: null,
    });
    mockCreateEndpointAsync.mockResolvedValue({
      id: 'new-ep',
      name: 'first-endpoint',
      active: true,
      scimBasePath: '/scim/endpoints/new-ep',
    });
    mockCreateCredentialAsync.mockResolvedValue({
      id: 'cred-1',
      label: 'onboarding-first',
      token: 'plaintext-bearer-abc123',
      createdAt: new Date().toISOString(),
    });
  });

  it('Step 1 Skip writes completedAt to localStorage and hides the wizard', async () => {
    renderWizard();
    expect(screen.getByTestId('onboarding-step-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onboarding-skip'));
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeTruthy();
  });

  it('Step 1 Get started advances to step 2', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    expect(screen.getByTestId('onboarding-step-2')).toBeInTheDocument();
  });

  it('Step 2 has entra-id preset preselected', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    const selected = screen.getByTestId('onboarding-preset-card-entra-id');
    expect(selected.getAttribute('data-selected')).toBe('true');
  });

  it('Step 2 click another preset card swaps the picked preset', () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-preset-card-minimal'));
    const newPick = screen.getByTestId('onboarding-preset-card-minimal');
    expect(newPick.getAttribute('data-selected')).toBe('true');
    const oldPick = screen.getByTestId('onboarding-preset-card-entra-id');
    expect(oldPick.getAttribute('data-selected')).toBe('false');
  });

  it('Step 2 Next fires useCreateEndpoint with the picked preset and advances to step 3', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-preset-card-rfc-standard'));
    fireEvent.click(screen.getByTestId('onboarding-step-2-next'));

    await waitFor(() => {
      expect(mockCreateEndpointAsync).toHaveBeenCalledTimes(1);
    });
    const calledBody = mockCreateEndpointAsync.mock.calls[0][0] as Record<string, unknown>;
    expect(calledBody.profilePreset).toBe('rfc-standard');
    expect(typeof calledBody.name).toBe('string');

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument();
    });
  });

  it('Step 3 Issue credential fires useCreateCredential bound to the created endpointId', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-step-2-next'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('onboarding-issue-credential'));

    await waitFor(() => {
      expect(mockCreateCredentialAsync).toHaveBeenCalledTimes(1);
    });
  });

  it('Step 3 plaintext token is rendered once after credential issue succeeds', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-step-2-next'));
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('onboarding-issue-credential'));

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-plaintext-token')).toBeInTheDocument();
    });
    expect(screen.getByTestId('onboarding-plaintext-token').textContent).toContain(
      'plaintext-bearer-abc123',
    );
  });

  it('Step 4 Send it now navigates to /workbench with urlencoded GET prefill shape', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-step-2-next'));
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('onboarding-issue-credential'));
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-plaintext-token')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('onboarding-step-3-next'));

    expect(screen.getByTestId('onboarding-step-4')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onboarding-send-it-now'));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalled();
    });
    const navArg = mockNavigate.mock.calls[0][0] as {
      to: string;
      search?: { prefill?: string };
    };
    expect(navArg.to).toBe('/workbench');
    expect(typeof navArg.search?.prefill).toBe('string');
    const decoded = decodeURIComponent(navArg.search!.prefill!);
    const parsed = JSON.parse(decoded) as { method: string; path: string };
    expect(parsed.method).toBe('GET');
    expect(parsed.path).toBe('/scim/endpoints/new-ep/Users');
  });

  it('Step 4 I will do this later writes completedAt and hides the wizard', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    fireEvent.click(screen.getByTestId('onboarding-step-2-next'));
    await waitFor(() => expect(screen.getByTestId('onboarding-step-3')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('onboarding-issue-credential'));
    await waitFor(() => expect(screen.getByTestId('onboarding-plaintext-token')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('onboarding-step-3-next'));

    expect(screen.getByTestId('onboarding-step-4')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onboarding-do-this-later'));

    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeTruthy();
  });

  it('Close X button at any step writes completedAt and dismisses', async () => {
    renderWizard();
    fireEvent.click(screen.getByTestId('onboarding-get-started'));
    expect(screen.getByTestId('onboarding-step-2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('onboarding-close'));
    await waitFor(() => {
      expect(screen.queryByTestId('onboarding-wizard')).not.toBeInTheDocument();
    });
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBeTruthy();
  });
});
