/**
 * KpiChart primitive tests.
 */
import React from 'react';
import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { KpiChart } from './KpiChart';

function wrap(ui: React.ReactElement) {
  return render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
}

beforeAll(() => {
  // recharts ResponsiveContainer measures its parent via ResizeObserver
  // and forwards a 0x0 size to the chart unless we shim the API. jsdom
  // doesn't include ResizeObserver, and zero-size renders a tooltip-only
  // tree which would skip our area path. Stub a resize observer that
  // immediately reports a sane non-zero box.
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).ResizeObserver = StubResizeObserver;
});

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
