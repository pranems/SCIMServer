import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('156')).toBeInTheDocument();
    // Active/Inactive labels with numbers
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('displays group count', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('displays activity stats', () => {
    render(<StatisticsTab statistics={mockStats} loading={false} />);
    expect(screen.getByText('4231')).toBeInTheDocument();
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
});
