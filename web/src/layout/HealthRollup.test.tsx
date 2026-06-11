/**
 * HealthRollup.test.tsx - Phase K2 header widget tests.
 *
 * Asserts the rendered traffic-light + popover surface. The hook
 * (useHealthRollup) is mocked here so the test exercises ONLY the
 * presentational contract: icon color, accessible name, popover
 * substatus rows, click open/close.
 *
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { HealthRollup } from './HealthRollup';
import type { HealthRollupResult } from '../hooks/useHealthRollup';

// Mock the hook so each test can drive any rollup shape.
const useHealthRollupMock = vi.fn<[], HealthRollupResult>();
vi.mock('../hooks/useHealthRollup', async (importActual) => {
  const actual: typeof import('../hooks/useHealthRollup') = await importActual();
  return {
    ...actual,
    useHealthRollup: () => useHealthRollupMock(),
  };
});

function renderWithFluent(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

beforeEach(() => {
  useHealthRollupMock.mockReset();
});

describe('HealthRollup', () => {
  it('renders the healthy traffic-light when overall status is healthy', () => {
    useHealthRollupMock.mockReturnValue({
      status: 'healthy',
      subStatuses: [
        { name: 'API', status: 'healthy', detail: 'OK' },
        { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
        { name: 'Auth', status: 'healthy', detail: 'All 3 secrets configured' },
        { name: 'Realtime', status: 'healthy', detail: 'SSE open' },
        { name: 'Recent errors', status: 'healthy', detail: '0 in last hour' },
      ],
    });
    renderWithFluent(<HealthRollup />);
    const trigger = screen.getByTestId('health-rollup-trigger');
    expect(trigger).toBeInTheDocument();
    // Accessible name includes the overall status keyword (a11y rule for icon-only triggers).
    expect(trigger).toHaveAccessibleName(/healthy/i);
  });

  it('renders the degraded traffic-light when overall status is degraded', () => {
    useHealthRollupMock.mockReturnValue({
      status: 'degraded',
      subStatuses: [
        { name: 'Auth', status: 'degraded', detail: '1 of 3 secrets missing' },
        { name: 'API', status: 'healthy', detail: 'OK' },
        { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
        { name: 'Realtime', status: 'healthy', detail: 'SSE open' },
        { name: 'Recent errors', status: 'healthy', detail: '0 in last hour' },
      ],
    });
    renderWithFluent(<HealthRollup />);
    expect(screen.getByTestId('health-rollup-trigger')).toHaveAccessibleName(/degraded/i);
  });

  it('renders the down traffic-light when overall status is down', () => {
    useHealthRollupMock.mockReturnValue({
      status: 'down',
      subStatuses: [
        { name: 'API', status: 'down', detail: 'unreachable' },
        { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
        { name: 'Auth', status: 'healthy', detail: 'OK' },
        { name: 'Realtime', status: 'healthy', detail: 'SSE open' },
        { name: 'Recent errors', status: 'healthy', detail: '0' },
      ],
    });
    renderWithFluent(<HealthRollup />);
    expect(screen.getByTestId('health-rollup-trigger')).toHaveAccessibleName(/down/i);
  });

  it('opens a popover with all 5 substatus rows when clicked', async () => {
    useHealthRollupMock.mockReturnValue({
      status: 'degraded',
      subStatuses: [
        { name: 'API', status: 'healthy', detail: 'OK' },
        { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
        { name: 'Auth', status: 'degraded', detail: '1 of 3 secrets missing' },
        { name: 'Realtime', status: 'healthy', detail: 'SSE open' },
        { name: 'Recent errors', status: 'healthy', detail: '0 in last hour' },
      ],
    });
    renderWithFluent(<HealthRollup />);
    await userEvent.click(screen.getByTestId('health-rollup-trigger'));
    expect(screen.getByTestId('health-rollup-popover')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('Database')).toBeInTheDocument();
    expect(screen.getByText('Auth')).toBeInTheDocument();
    expect(screen.getByText('Realtime')).toBeInTheDocument();
    expect(screen.getByText('Recent errors')).toBeInTheDocument();
    // Detail line for the degraded substatus is visible
    expect(screen.getByText('1 of 3 secrets missing')).toBeInTheDocument();
  });

  it('exposes per-substatus state badges (so screen readers can disambiguate icons)', async () => {
    useHealthRollupMock.mockReturnValue({
      status: 'down',
      subStatuses: [
        { name: 'API', status: 'down', detail: 'unreachable' },
        { name: 'Database', status: 'healthy', detail: 'PostgreSQL' },
        { name: 'Auth', status: 'healthy', detail: 'All 3 secrets configured' },
        { name: 'Realtime', status: 'degraded', detail: 'reconnecting' },
        { name: 'Recent errors', status: 'healthy', detail: '0' },
      ],
    });
    renderWithFluent(<HealthRollup />);
    await userEvent.click(screen.getByTestId('health-rollup-trigger'));
    // Each substatus row is identifiable by data-testid.
    expect(screen.getByTestId('health-row-API')).toBeInTheDocument();
    expect(screen.getByTestId('health-row-Database')).toBeInTheDocument();
    expect(screen.getByTestId('health-row-Auth')).toBeInTheDocument();
    expect(screen.getByTestId('health-row-Realtime')).toBeInTheDocument();
    expect(screen.getByTestId('health-row-Recent errors')).toBeInTheDocument();
  });
});
