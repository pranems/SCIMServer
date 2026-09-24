import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { LogFiltersToolbar, timeRangeToSince } from './LogFiltersToolbar';

describe('LogFiltersToolbar', () => {
  it('emits shared URL, method, status, time, error, duration, request, and reset filters', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const onReset = vi.fn();
    render(
      <FluentProvider theme={webLightTheme}>
        <LogFiltersToolbar
          values={{ urlContains: 'Devices', method: 'PATCH' }}
          endpoints={[{ id: 'ep-1', name: 'Endpoint one' }]}
          onChange={onChange}
          onReset={onReset}
          data-testid="filters"
        />
      </FluentProvider>,
    );

    expect(screen.getByTestId('filters-url')).toHaveValue('Devices');
    expect(screen.getByTestId('filters-method')).toHaveValue('PATCH');
    await user.click(screen.getByText('412'));
    expect(onChange).toHaveBeenCalledWith({ status: 412 });
    await user.click(screen.getByText('Last 24 hours'));
    expect(onChange).toHaveBeenCalledWith({ timeRange: '24h' });
    await user.click(screen.getByTestId('filters-errors'));
    expect(onChange).toHaveBeenCalledWith({ hasError: true });
    fireEvent.change(screen.getByTestId('filters-duration'), { target: { value: '250' } });
    expect(onChange).toHaveBeenLastCalledWith({ minDurationMs: 250 });
    await user.click(screen.getByTestId('filters-reset'));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('converts closed time ranges to lower bounds and ignores custom', () => {
    const now = Date.now();
    const since = timeRangeToSince('1h');
    expect(since).toBeDefined();
    expect(now - new Date(since!).getTime()).toBeGreaterThanOrEqual(60 * 60 * 1000 - 1000);
    expect(timeRangeToSince('custom')).toBeUndefined();
  });

  it('does not treat pagination metadata as an active log filter', () => {
    render(
      <FluentProvider theme={webLightTheme}>
        <LogFiltersToolbar
          values={{ page: 1 } as never}
          onChange={vi.fn()}
          onReset={vi.fn()}
          data-testid="filters"
        />
      </FluentProvider>,
    );

    expect(screen.queryByTestId('filters-reset')).not.toBeInTheDocument();
  });
});
