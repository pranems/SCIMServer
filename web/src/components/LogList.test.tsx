import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LogList } from './LogList';

const sampleItems = [
  {
    id: '1',
    method: 'GET',
    url: '/scim/endpoints/abc/Users',
    status: 200,
    durationMs: 42,
    createdAt: '2026-04-13T10:00:00Z',
  },
  {
    id: '2',
    method: 'POST',
    url: '/scim/endpoints/abc/Users',
    status: 201,
    durationMs: 55,
    createdAt: '2026-04-13T10:01:00Z',
    reportableIdentifier: 'jdoe@example.com',
  },
  {
    id: '3',
    method: 'DELETE',
    url: '/scim/endpoints/abc/Users/xyz',
    status: 204,
    durationMs: 12,
    createdAt: '2026-04-13T10:02:00Z',
  },
];

describe('LogList', () => {
  it('renders the table heading with count', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Request Logs (3)');
  });

  it('renders table column headers', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByText('Time')).toBeInTheDocument();
    expect(screen.getByText('Method')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Identifier')).toBeInTheDocument();
    expect(screen.getByText('URL')).toBeInTheDocument();
  });

  it('renders method badges for each row', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByText('GET')).toBeInTheDocument();
    expect(screen.getByText('POST')).toBeInTheDocument();
    expect(screen.getByText('DELETE')).toBeInTheDocument();
  });

  it('renders status codes', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('201')).toBeInTheDocument();
    expect(screen.getByText('204')).toBeInTheDocument();
  });

  it('renders identifier when present', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByText('jdoe@example.com')).toBeInTheDocument();
  });

  it('renders duration in ms', () => {
    render(<LogList items={sampleItems} loading={false} onSelect={() => {}} />);
    expect(screen.getByText('42ms')).toBeInTheDocument();
    expect(screen.getByText('55ms')).toBeInTheDocument();
  });

  it('shows empty state when no items', () => {
    render(<LogList items={[]} loading={false} onSelect={() => {}} />);
    // Empty state shows "Request Logs" without count
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Request Logs');
  });

  it('calls onSelect when a row is clicked', async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <LogList items={sampleItems} loading={false} onSelect={onSelect} />
    );

    // Click the first table body row
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBe(3);
    rows[0].click();
    expect(onSelect).toHaveBeenCalledWith(sampleItems[0]);
  });
});
