import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogFilters } from './LogFilters';
import type { LogQuery } from '../api/client';

const renderFilters = (overrides: Partial<LogQuery> = {}) => {
  const value: LogQuery = { page: 1, ...overrides };
  const onChange = vi.fn();
  const onReset = vi.fn();
  const onFilterCommit = vi.fn();
  render(
    <LogFilters
      value={value}
      onChange={onChange}
      onReset={onReset}
      onFilterCommit={onFilterCommit}
      loading={false}
    />
  );
  return { onChange, onReset, onFilterCommit };
};

describe('LogFilters', () => {
  it('renders method dropdown with options', () => {
    renderFilters();
    const select = screen.getByLabelText('HTTP Method filter') as HTMLSelectElement;
    expect(select).toBeInTheDocument();
    expect(select.value).toBe('');
    // Check all HTTP method options exist
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('PATCH')).toBeInTheDocument();
    expect(screen.getByText('DELETE')).toBeInTheDocument();
  });

  it('renders status input', () => {
    renderFilters();
    expect(screen.getByLabelText('Status code filter')).toBeInTheDocument();
  });

  it('renders error filter dropdown', () => {
    renderFilters();
    const select = screen.getByLabelText('Error presence filter');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('Only Errors')).toBeInTheDocument();
    expect(screen.getByText('No Errors')).toBeInTheDocument();
  });

  it('renders URL contains input', () => {
    renderFilters();
    expect(screen.getByPlaceholderText('URL contains')).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderFilters();
    expect(screen.getByPlaceholderText('Search (url or error)')).toBeInTheDocument();
  });

  it('renders date range inputs', () => {
    renderFilters();
    expect(screen.getByLabelText('Since date filter')).toBeInTheDocument();
    expect(screen.getByLabelText('Until date filter')).toBeInTheDocument();
  });

  it('renders Reset button', () => {
    renderFilters();
    expect(screen.getByText('Reset')).toBeInTheDocument();
  });

  it('calls onChange when method is selected', async () => {
    const user = userEvent.setup();
    const { onChange } = renderFilters();

    await user.selectOptions(screen.getByLabelText('HTTP Method filter'), 'GET');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', page: 1 })
    );
  });

  it('calls onReset and onFilterCommit when Reset clicked', async () => {
    const user = userEvent.setup();
    const { onReset, onFilterCommit } = renderFilters({ method: 'GET' });

    await user.click(screen.getByText('Reset'));
    expect(onReset).toHaveBeenCalledOnce();
    expect(onFilterCommit).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });
});
