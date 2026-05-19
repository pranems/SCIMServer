/**
 * KpiChart primitive tests.
 *
 * NOTE: ResizeObserver is shimmed globally in `web/src/test/setup.ts`.
 * Earlier versions of this file installed the shim in `beforeAll` but
 * that pattern leaked across describe blocks and other test files.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { KpiChart } from './KpiChart';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

describe('KpiChart', () => {
  it('renders the empty fallback when data is empty', () => {
    wrap(<KpiChart data={[]} label="Users" />);
    expect(screen.getByTestId('kpi-chart-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-chart')).not.toBeInTheDocument();
  });

  it('renders the empty fallback when data has only one point', () => {
    // recharts treats a single point as a vertical line - users would
    // see what looks like a render bug. We bail out explicitly.
    wrap(<KpiChart data={[42]} label="Users" />);
    expect(screen.getByTestId('kpi-chart-empty')).toBeInTheDocument();
  });

  it('renders the chart container when data has 2 or more points', () => {
    wrap(<KpiChart data={[1, 4, 9, 16, 25]} label="Users" />);
    expect(screen.getByTestId('kpi-chart')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-chart-empty')).not.toBeInTheDocument();
  });

  it('exposes the label as the aria-label for accessibility', () => {
    wrap(<KpiChart data={[1, 2]} label="Active users (7d)" />);
    expect(screen.getByTestId('kpi-chart')).toHaveAttribute(
      'aria-label',
      'Active users (7d)',
    );
  });

  it('honors a custom data-testid', () => {
    wrap(<KpiChart data={[1, 2, 3]} label="X" data-testid="users-trend" />);
    expect(screen.getByTestId('users-trend')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-chart')).not.toBeInTheDocument();
  });

  it('renders the empty fallback with descriptive aria-label', () => {
    wrap(<KpiChart data={[]} label="Logs" />);
    const empty = screen.getByTestId('kpi-chart-empty');
    expect(empty).toHaveAttribute('aria-label', expect.stringContaining('Logs'));
    expect(empty).toHaveAttribute('aria-label', expect.stringContaining('no trend'));
  });
});
