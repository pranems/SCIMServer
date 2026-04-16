import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DatabaseBrowser } from './DatabaseBrowser';
import { AuthProvider } from '../../hooks/useAuth';
import { setStoredToken, clearStoredToken } from '../../auth/token';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const mockStats = {
  users: { total: 5, active: 3, inactive: 2 },
  groups: { total: 2 },
  activity: { totalRequests: 100, last24Hours: 15 },
  database: { type: 'PostgreSQL', persistenceBackend: 'prisma' },
};

const mockUsers = {
  users: [
    { id: 'u1', userName: 'alice@test.com', scimId: 'scim-1', active: true, createdAt: '2026-04-01', updatedAt: '2026-04-01', groups: [] },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
};

const mockGroups = {
  groups: [
    { id: 'g1', displayName: 'Eng', scimId: 'grp-1', memberCount: 3, createdAt: '2026-04-01', updatedAt: '2026-04-01' },
  ],
  pagination: { page: 1, limit: 20, total: 1, pages: 1 },
};

const renderBrowser = () => {
  render(
    <AuthProvider>
      <DatabaseBrowser />
    </AuthProvider>
  );
};

describe('DatabaseBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setStoredToken('test-token');
    mockFetch.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('/database/statistics')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockStats) });
      }
      if (typeof url === 'string' && url.includes('/database/users')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockUsers) });
      }
      if (typeof url === 'string' && url.includes('/database/groups')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(mockGroups) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
    });
  });

  afterEach(() => clearStoredToken());

  it('renders the Database Browser heading', () => {
    renderBrowser();
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Database Browser');
  });

  it('renders 3 tab buttons', () => {
    renderBrowser();
    const buttons = screen.getAllByRole('button');
    const tabButtons = buttons.filter(b =>
      b.textContent?.includes('Statistics') ||
      b.textContent?.includes('Users') ||
      b.textContent?.includes('Groups')
    );
    expect(tabButtons.length).toBe(3);
  });

  it('shows statistics tab by default', async () => {
    renderBrowser();
    await waitFor(() => {
      const headings = screen.getAllByRole('heading', { level: 3 });
      expect(headings.some(h => h.textContent?.includes('Users'))).toBe(true);
    });
  });

  it('shows user count in tab after loading stats', async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Users \(5\)/)).toBeInTheDocument());
  });

  it('shows group count in tab after loading stats', async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Groups \(2\)/)).toBeInTheDocument());
  });

  it('switches to Users tab on click', async () => {
    const user = userEvent.setup();
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Users \(5\)/)).toBeInTheDocument());
    await user.click(screen.getByText(/Users \(5\)/));
    await waitFor(() => expect(screen.getByPlaceholderText(/search users/i)).toBeInTheDocument());
  });

  it('switches to Groups tab on click', async () => {
    const user = userEvent.setup();
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Groups \(2\)/)).toBeInTheDocument());
    await user.click(screen.getByText(/Groups \(2\)/));
    await waitFor(() => expect(screen.getByPlaceholderText(/search groups/i)).toBeInTheDocument());
  });

  it('renders user list in Users tab', async () => {
    const user = userEvent.setup();
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Users \(5\)/)).toBeInTheDocument());
    await user.click(screen.getByText(/Users \(5\)/));
    await waitFor(() => expect(screen.getByText('alice@test.com')).toBeInTheDocument());
  });

  it('renders group list in Groups tab', async () => {
    const user = userEvent.setup();
    renderBrowser();
    await waitFor(() => expect(screen.getByText(/Groups \(2\)/)).toBeInTheDocument());
    await user.click(screen.getByText(/Groups \(2\)/));
    await waitFor(() => expect(screen.getByText('Eng')).toBeInTheDocument());
  });

  it('fetches statistics with auth header', async () => {
    renderBrowser();
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const statsCall = mockFetch.mock.calls.find(([url]: [string]) => url?.includes('/statistics'));
    expect(statsCall).toBeDefined();
    expect(statsCall![1]?.headers?.Authorization).toBe('Bearer test-token');
  });
});
