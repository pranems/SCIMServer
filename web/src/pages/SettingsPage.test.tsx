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
  return { ...actual, useVersion: vi.fn(), useHealth: vi.fn() };
});

import { useVersion, useHealth } from '../api/queries';

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
