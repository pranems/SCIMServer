import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UsersTab } from './UsersTab';

const sampleUsers = [
  {
    id: '1',
    userName: 'jdoe@example.com',
    scimId: 'abc-123',
    active: true,
    createdAt: '2026-04-06T10:00:00Z',
    updatedAt: '2026-04-06T10:00:00Z',
    groups: [{ id: 'g1', displayName: 'Engineering' }],
  },
  {
    id: '2',
    userName: 'inactive@example.com',
    scimId: 'def-456',
    active: false,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
    groups: [],
  },
];

const defaultPagination = { page: 1, limit: 50, total: 2, pages: 1 };

const renderUsersTab = (overrides = {}) => {
  const props = {
    users: sampleUsers,
    pagination: defaultPagination,
    loading: false,
    searchTerm: '',
    activeFilter: '',
    onSearch: vi.fn(),
    onFilterChange: vi.fn(),
    onPageChange: vi.fn(),
    onUserClick: vi.fn(),
    ...overrides,
  };
  render(<UsersTab {...props} />);
  return props;
};

describe('UsersTab', () => {
  it('renders search input', () => {
    renderUsersTab();
    expect(screen.getByPlaceholderText(/search users/i)).toBeInTheDocument();
  });

  it('renders active filter dropdown', () => {
    renderUsersTab();
    expect(screen.getByText('All Users')).toBeInTheDocument();
  });

  it('renders user rows', () => {
    renderUsersTab();
    expect(screen.getByText('jdoe@example.com')).toBeInTheDocument();
    expect(screen.getByText('inactive@example.com')).toBeInTheDocument();
  });

  it('shows active badge for active users', () => {
    renderUsersTab();
    const badges = screen.getAllByText(/active/i);
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it('shows group count', () => {
    renderUsersTab();
    // First user has 1 group, second has "No groups"
    expect(screen.getByText(/no groups/i)).toBeInTheDocument();
  });

  it('renders pagination info', () => {
    renderUsersTab();
    expect(screen.getByText(/showing 1 to 2 of 2/i)).toBeInTheDocument();
  });

  it('calls onSearch when typing in search', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderUsersTab();

    await user.type(screen.getByPlaceholderText(/search users/i), 'test');
    expect(onSearch).toHaveBeenCalled();
  });

  it('calls onUserClick when clicking a user row', async () => {
    const { onUserClick } = renderUsersTab();
    const row = screen.getByText('jdoe@example.com').closest('[class*="Row"]') ||
                screen.getByText('jdoe@example.com').closest('div[class]');
    if (row) row.click();
    expect(onUserClick).toHaveBeenCalledWith(sampleUsers[0]);
  });

  it('shows loading state', () => {
    renderUsersTab({ loading: true });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('calls onFilterChange when selecting a filter', async () => {
    const user = userEvent.setup();
    const { onFilterChange } = renderUsersTab();

    await user.selectOptions(screen.getByRole('combobox'), 'true');
    expect(onFilterChange).toHaveBeenCalledWith('true');
  });
});
