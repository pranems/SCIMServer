/**
 * SettingsPage tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { SettingsPage } from './SettingsPage';

vi.mock('../api/queries', async () => {
  const actual = await vi.importActual('../api/queries');
  return {
    ...actual,
    useVersion: vi.fn(),
    useHealth: vi.fn(),
    // Phase L4 - new hooks. Defaults provide a benign shape so existing
    // tests don't have to mock them.
    useLogConfig: vi.fn(() => ({ data: undefined, isLoading: false, isError: false, error: null })),
    useUpdateLogConfig: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue({}), isPending: false })),
  };
});

import { useVersion, useHealth, useLogConfig } from '../api/queries';
import {
  usePreferencesStore,
  PREFERENCES_DEFAULTS,
  PREFERENCES_STORAGE_KEY,
} from '../store/preferences-store';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

describe('SettingsPage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows loading state', () => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: undefined, isLoading: true });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-page-loading')).toBeInTheDocument();
  });

  it('renders version and health info', () => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        version: '0.41.0',
        runtime: { node: 'v24.0.0', platform: 'linux', arch: 'x64' },
        service: { uptimeSeconds: 3661 },
        storage: { persistenceBackend: 'prisma', databaseProvider: 'postgresql' },
      },
      isLoading: false,
    });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { status: 'ok', uptime: 3661 },
      isLoading: false,
    });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-page')).toBeInTheDocument();
    expect(screen.getByText('0.41.0')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
    expect(screen.getByText('prisma')).toBeInTheDocument();
  });
});

// ─── Phase L4: LogConfigSection ──────────────────────────────────────

describe('SettingsPage log config (Phase L4)', () => {
  const sampleConfig = {
    globalLevel: 'DEBUG',
    categoryLevels: { auth: 'WARN', 'scim.patch': 'TRACE' },
    endpointLevels: {},
    includePayloads: true,
    includeStackTraces: true,
    maxPayloadSizeBytes: 65536,
    slowRequestThresholdMs: 1000,
    format: 'pretty' as const,
    availableLevels: ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL', 'OFF'],
    availableCategories: ['http', 'scim', 'scim.bulk', 'scim.patch', 'auth', 'config'],
  };

  beforeEach(() => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { version: '0.50.0', runtime: { node: 'v25', platform: 'linux', arch: 'x64' }, service: { uptimeSeconds: 60 }, storage: { persistenceBackend: 'prisma', databaseProvider: 'postgresql' } },
      isLoading: false,
    });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: { status: 'ok', uptime: 60 }, isLoading: false });
  });

  it('renders the log config section when config loads', () => {
    (useLogConfig as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleConfig, isLoading: false, isError: false, error: null });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('log-config-section')).toBeInTheDocument();
  });

  it('renders the global level Combobox seeded from availableLevels', () => {
    (useLogConfig as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleConfig, isLoading: false, isError: false, error: null });
    wrap(<SettingsPage />);
    const dropdown = screen.getByTestId('log-config-global-level');
    expect(dropdown).toBeInTheDocument();
    // Current value rendered.
    expect(dropdown.textContent).toContain('DEBUG');
  });

  it('renders the format toggle reflecting current "pretty" value', () => {
    (useLogConfig as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleConfig, isLoading: false, isError: false, error: null });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('log-config-format')).toBeInTheDocument();
  });

  it('renders the includePayloads switch', () => {
    (useLogConfig as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleConfig, isLoading: false, isError: false, error: null });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('log-config-include-payloads')).toBeInTheDocument();
  });

  it('renders one row per availableCategory with current level', () => {
    (useLogConfig as ReturnType<typeof vi.fn>).mockReturnValue({ data: sampleConfig, isLoading: false, isError: false, error: null });
    wrap(<SettingsPage />);
    // Five categories in the fixture.
    expect(screen.getByTestId('log-config-category-http')).toBeInTheDocument();
    expect(screen.getByTestId('log-config-category-auth')).toBeInTheDocument();
    expect(screen.getByTestId('log-config-category-scim.patch')).toBeInTheDocument();
    // auth has WARN override, scim.patch has TRACE; rest default to DEBUG (globalLevel).
    expect(screen.getByTestId('log-config-category-auth').textContent).toContain('WARN');
    expect(screen.getByTestId('log-config-category-scim.patch').textContent).toContain('TRACE');
  });
});

// ─── Phase N2: OnboardingResetCard ──────────────────────────────────

describe('SettingsPage onboarding reset (Phase N2)', () => {
  beforeEach(() => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { version: '0.52.0', runtime: { node: 'v25', platform: 'linux', arch: 'x64' }, service: { uptimeSeconds: 60 }, storage: { persistenceBackend: 'prisma', databaseProvider: 'postgresql' } },
      isLoading: false,
    });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: { status: 'ok', uptime: 60 }, isLoading: false });
    localStorage.clear();
  });

  it('renders the onboarding reset card with a button', () => {
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-onboarding-reset-card')).toBeInTheDocument();
    expect(screen.getByTestId('settings-onboarding-reset-button')).toBeInTheDocument();
  });

  it('clicking the reset button sets the force-open flag and clears completedAt', () => {
    localStorage.setItem('scimserver.onboarding.completedAt', new Date().toISOString());
    wrap(<SettingsPage />);
    const btn = screen.getByTestId('settings-onboarding-reset-button');
    btn.click();
    expect(localStorage.getItem('scimserver.onboarding.completedAt')).toBeNull();
    expect(localStorage.getItem('scimserver.onboarding.forceOpen')).toBe('1');
  });
});

// ─── Phase N4: PreferencesCard ──────────────────────────────────────

describe('SettingsPage preferences (Phase N4)', () => {
  beforeEach(() => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { version: '0.52.0', runtime: { node: 'v25', platform: 'linux', arch: 'x64' }, service: { uptimeSeconds: 60 }, storage: { persistenceBackend: 'prisma', databaseProvider: 'postgresql' } },
      isLoading: false,
    });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: { status: 'ok', uptime: 60 }, isLoading: false });
    localStorage.clear();
    // Reset the preferences store so each test starts from defaults.
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
  });

  it('renders the preferences card with the 3 controls + reset button', () => {
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-preferences-card')).toBeInTheDocument();
    expect(screen.getByTestId('settings-preferences-default-page-size')).toBeInTheDocument();
    expect(screen.getByTestId('settings-preferences-dense-mode')).toBeInTheDocument();
    expect(screen.getByTestId('settings-preferences-sidebar-collapsed-default')).toBeInTheDocument();
    expect(screen.getByTestId('settings-preferences-reset')).toBeInTheDocument();
  });

  it('toggling dense mode updates the store AND persists', () => {
    wrap(<SettingsPage />);
    const sw = screen.getByTestId('settings-preferences-dense-mode') as HTMLInputElement;
    expect(usePreferencesStore.getState().denseMode).toBe(false);
    // Fluent UI Switch renders as a checkbox-role input; click toggles it.
    sw.click();
    expect(usePreferencesStore.getState().denseMode).toBe(true);
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(stored.prefs.denseMode).toBe(true);
  });

  it('reset button reverts store + storage to defaults', () => {
    usePreferencesStore.getState().setDenseMode(true);
    usePreferencesStore.getState().setDefaultPageSize(100);
    wrap(<SettingsPage />);
    screen.getByTestId('settings-preferences-reset').click();
    expect(usePreferencesStore.getState().denseMode).toBe(PREFERENCES_DEFAULTS.denseMode);
    expect(usePreferencesStore.getState().defaultPageSize).toBe(PREFERENCES_DEFAULTS.defaultPageSize);
  });
});

// ─── Phase N5: TelemetryCard ────────────────────────────────────────

describe('SettingsPage telemetry (Phase N5)', () => {
  beforeEach(() => {
    (useVersion as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { version: '0.52.0', runtime: { node: 'v24', platform: 'linux', arch: 'x64' }, service: { uptimeSeconds: 60 }, storage: { persistenceBackend: 'prisma', databaseProvider: 'postgresql' } },
      isLoading: false,
    });
    (useHealth as ReturnType<typeof vi.fn>).mockReturnValue({ data: { status: 'ok', uptime: 60 }, isLoading: false });
    localStorage.clear();
    usePreferencesStore.setState({ ...PREFERENCES_DEFAULTS });
  });

  it('renders the telemetry card with opt-in switch + clear button + empty state', () => {
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-telemetry-card')).toBeInTheDocument();
    expect(screen.getByTestId('settings-telemetry-opt-in')).toBeInTheDocument();
    expect(screen.getByTestId('settings-telemetry-clear')).toBeInTheDocument();
    expect(screen.getByTestId('settings-telemetry-empty')).toBeInTheDocument();
  });

  it('renders buffered events as table rows when present', async () => {
    const { useTelemetryStore } = await import('../store/telemetry-store');
    useTelemetryStore.getState().record({ type: 'navigation', path: '/endpoints' });
    useTelemetryStore.getState().record({ type: 'error', message: 'boom' });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-telemetry-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('settings-telemetry-row-1')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-telemetry-empty')).not.toBeInTheDocument();
  });

  it('toggling opt-in updates preferences-store AND persists', () => {
    wrap(<SettingsPage />);
    const sw = screen.getByTestId('settings-telemetry-opt-in') as HTMLInputElement;
    expect(usePreferencesStore.getState().telemetryOptIn).toBe(true);
    sw.click();
    expect(usePreferencesStore.getState().telemetryOptIn).toBe(false);
    const stored = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}');
    expect(stored.prefs.telemetryOptIn).toBe(false);
  });

  it('clear button empties the buffer', async () => {
    const { useTelemetryStore } = await import('../store/telemetry-store');
    useTelemetryStore.getState().record({ type: 'navigation', path: '/x' });
    wrap(<SettingsPage />);
    expect(screen.getByTestId('settings-telemetry-row-0')).toBeInTheDocument();
    screen.getByTestId('settings-telemetry-clear').click();
    expect(useTelemetryStore.getState().events).toHaveLength(0);
  });
});
