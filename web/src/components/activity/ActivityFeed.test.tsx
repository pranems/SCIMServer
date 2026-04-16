import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ActivityFeed } from './ActivityFeed';
import { AuthProvider } from '../../hooks/useAuth';
import { setStoredToken, clearStoredToken } from '../../auth/token';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockSummary = {
  summary: {
    last24Hours: 42,
    lastWeek: 150,
    operations: { users: 88, groups: 30 },
  },
};

const mockActivities = {
  activities: [
    { id: '1', timestamp: new Date().toISOString(), icon: '👤', message: 'User created: test@example.com', type: 'user', severity: 'success' },
    { id: '2', timestamp: new Date().toISOString(), icon: '❌', message: 'Failed to get user', type: 'user', severity: 'error', details: 'HTTP 404' },
    { id: '3', timestamp: new Date().toISOString(), icon: '🏢', message: 'Group created: Engineering', type: 'group', severity: 'success' },
  ],
  pagination: { page: 1, limit: 50, total: 3, pages: 1 },
  filters: { types: ['user', 'group', 'system'], severities: ['info', 'success', 'warning', 'error'] },
};

const renderFeed = () => {
  const onHideChange = vi.fn();
  render(
    <AuthProvider>
      <ActivityFeed hideKeepalive={true} onHideKeepaliveChange={onHideChange} />
    </AuthProvider>
  );
  return { onHideChange };
};

describe('ActivityFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoredToken('test-token');
    // Default: return summary for /summary, activities for /activity
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/activity/summary')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockSummary) });
      }
      if (typeof url === 'string' && url.includes('/activity')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockActivities) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => {
    clearStoredToken();
  });

  it('renders the Activity Feed heading', async () => {
    renderFeed();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Activity Feed');
  });

  it('renders summary cards with data', async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('30')).toBeInTheDocument();
  });

  it('renders summary card labels', async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByText('Last 24 hours')).toBeInTheDocument());
    expect(screen.getByText('Last 7 days')).toBeInTheDocument();
    expect(screen.getByText('User operations')).toBeInTheDocument();
    expect(screen.getByText('Group operations')).toBeInTheDocument();
  });

  it('renders activity items', async () => {
    renderFeed();
    await waitFor(() => expect(screen.getByText(/User created: test@example.com/)).toBeInTheDocument());
    expect(screen.getByText(/Failed to get user/)).toBeInTheDocument();
    expect(screen.getByText(/Group created: Engineering/)).toBeInTheDocument();
  });

  it('renders search input', () => {
    renderFeed();
    expect(screen.getByPlaceholderText('Search activities...')).toBeInTheDocument();
  });

  it('renders type filter dropdown', () => {
    renderFeed();
    expect(screen.getByTitle('Filter by activity type')).toBeInTheDocument();
  });

  it('renders severity filter dropdown', () => {
    renderFeed();
    expect(screen.getByTitle('Filter by severity')).toBeInTheDocument();
  });

  it('renders auto-refresh checkbox (checked by default)', () => {
    renderFeed();
    const checkbox = screen.getByRole('checkbox', { name: /auto-refresh/i });
    expect(checkbox).toBeChecked();
  });

  it('renders hide keepalive checkbox', () => {
    renderFeed();
    const checkbox = screen.getByRole('checkbox', { name: /hide keepalive/i });
    expect(checkbox).toBeChecked();
  });

  it('shows empty state when no activities', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/summary')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ summary: { last24Hours: 0, lastWeek: 0, operations: { users: 0, groups: 0 } } }) });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ activities: [], pagination: { page: 1, limit: 50, total: 0, pages: 0 }, filters: {} }),
      });
    });
    renderFeed();
    await waitFor(() => expect(screen.getByText(/no activities found/i)).toBeInTheDocument());
  });

  it('shows loading state initially when no token', () => {
    clearStoredToken();
    renderFeed();
    // Without token, no fetch happens, should show empty state or nothing
    expect(screen.queryByText('Loading activities...')).not.toBeInTheDocument();
  });

  it('calls fetch with hideKeepalive param', async () => {
    renderFeed();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const activityCall = mockFetch.mock.calls.find(
      ([url]: [string]) => typeof url === 'string' && url.includes('/activity?') && !url.includes('/summary')
    );
    expect(activityCall).toBeDefined();
    expect(activityCall![0]).toContain('hideKeepalive=true');
  });

  it('sends auth header in requests', async () => {
    renderFeed();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const anyCall = mockFetch.mock.calls[0];
    expect(anyCall[1]?.headers?.Authorization).toBe('Bearer test-token');
  });
});
