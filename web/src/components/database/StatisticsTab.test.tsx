import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatisticsTab } from './StatisticsTab';

const mockStats = {
  users: { total: 156, active: 142, inactive: 14 },
  groups: { total: 12 },
  activity: { totalRequests: 4231, last24Hours: 142 },
  database: { type: 'PostgreSQL', persistenceBackend: 'prisma' as const },
};

const mockStatsInMemory = {
  users: { total: 5, active: 3, inactive: 2 },
  groups: { total: 1 },
  activity: { totalRequests: 0, last24Hours: 0 },
  database: { type: 'In-Memory', persistenceBackend: 'inmemory' as const },
};

describe('StatisticsTab', () => {
  it('renders 4 stat cards when data is provided', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.length).toBe(4);
  });

  it('displays user stats correctly', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText(/Active/)).toBeInTheDocument();
    expect(screen.getByText(/Inactive/)).toBeInTheDocument();
  });

  it('displays group count', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('Total Groups')).toBeInTheDocument();
  });

  it('displays activity stats', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('Total Requests')).toBeInTheDocument();
    expect(screen.getByText('Last 24 Hours')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<StatisticsTab statistics={null} loading={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows error state when no data and not loading', () => {
    render(<StatisticsTab statistics={null} loading={false} />);
    expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
  });

  it('displays PostgreSQL when backend is prisma', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('PostgreSQL')).toBeInTheDocument();
    expect(screen.queryByText('SQLite')).not.toBeInTheDocument();
  });

  it('displays In-Memory when backend is inmemory', () => {
    render(<StatisticsTab statistics={mockStatsInMemory} loading={false} />);
    expect(screen.getByText('In-Memory')).toBeInTheDocument();
  });

  it('does not show ephemeral warning for PostgreSQL', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.queryByText(/ephemeral/i)).not.toBeInTheDocument();
  });

  it('shows ephemeral note for in-memory backend', () => {
    render(<StatisticsTab statistics={mockStatsInMemory} loading={false} />);
    expect(screen.getByText(/ephemeral/i)).toBeInTheDocument();
  });

  it('shows refresh button when onRefresh callback provided', () => {
    const onRefresh = vi.fn();
    render(<StatisticsTab statistics={mockStats} loading={false} onRefresh={onRefresh} />);
    const btn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(btn);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('shows last updated timestamp', () => {
    const now = new Date();
    render(<StatisticsTab statistics={mockStats} loading={false} lastUpdated={now} />);
    expect(screen.getByText(/updated/i)).toBeInTheDocument();
  });

  it('navigates to users when clicking active count', () => {
    const onNavigate = vi.fn();
    render(<StatisticsTab statistics={mockStats} loading={false} onNavigate={onNavigate} />);
    // Click the active stat item
    const activeItem = screen.getByTitle('View active users');
    fireEvent.click(activeItem);
    expect(onNavigate).toHaveBeenCalledWith('users', 'true');
  });

  it('navigates to groups when clicking group total', () => {
    const onNavigate = vi.fn();
    render(<StatisticsTab statistics={mockStats} loading={false} onNavigate={onNavigate} />);
    const groupItem = screen.getByTitle('View all groups');
    fireEvent.click(groupItem);
    expect(onNavigate).toHaveBeenCalledWith('groups');
  });

  it('shows active percentage in breakdown', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    // 142/156 = 91%
    expect(screen.getByText(/91%/)).toBeInTheDocument();
  });

  it('shows avg requests per hour', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('Avg/Hour')).toBeInTheDocument();
  });

  it('shows total resources for non-inmemory backend', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('Total Resources')).toBeInTheDocument();
  });

  it('still renders stats during refresh (loading=true with existing data)', () => {
    render(<StatisticsTab statistics={mockStats} loading={true} />);
    // Should show data, not the loading spinner
    expect(screen.getByText('Total Users')).toBeInTheDocument();
    expect(screen.getByText(/refreshing/i)).toBeInTheDocument();
  });
});
