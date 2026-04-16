import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupsTab } from './GroupsTab';

const sampleGroups = [
  {
    id: 'g1',
    displayName: 'Engineering',
    scimId: 'grp-abc',
    memberCount: 5,
    createdAt: '2026-03-15T10:00:00Z',
    updatedAt: '2026-03-15T10:00:00Z',
  },
  {
    id: 'g2',
    displayName: 'Product',
    scimId: 'grp-def',
    memberCount: 0,
    createdAt: '2026-03-20T10:00:00Z',
    updatedAt: '2026-03-20T10:00:00Z',
  },
];

const defaultPagination = { page: 1, limit: 50, total: 2, pages: 1 };

const renderGroupsTab = (overrides = {}) => {
  const props = {
    groups: sampleGroups,
    pagination: defaultPagination,
    loading: false,
    searchTerm: '',
    onSearch: vi.fn(),
    onPageChange: vi.fn(),
    onGroupClick: vi.fn(),
    ...overrides,
  };
  render(<GroupsTab {...props} />);
  return props;
};

describe('GroupsTab', () => {
  it('renders search input', () => {
    renderGroupsTab();
    expect(screen.getByPlaceholderText(/search groups/i)).toBeInTheDocument();
  });

  it('renders group names', () => {
    renderGroupsTab();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
  });

  it('renders member counts', () => {
    renderGroupsTab();
    expect(screen.getByText('5 members')).toBeInTheDocument();
    expect(screen.getByText('0 members')).toBeInTheDocument();
  });

  it('renders pagination info', () => {
    renderGroupsTab();
    expect(screen.getByText(/showing 1 to 2 of 2/i)).toBeInTheDocument();
  });

  it('calls onSearch when typing', async () => {
    const user = userEvent.setup();
    const { onSearch } = renderGroupsTab();

    await user.type(screen.getByPlaceholderText(/search groups/i), 'eng');
    expect(onSearch).toHaveBeenCalled();
  });

  it('calls onGroupClick when clicking a group row', async () => {
    const { onGroupClick } = renderGroupsTab();
    const row = screen.getByText('Engineering').closest('[class*="Row"]') ||
                screen.getByText('Engineering').closest('div[class]');
    if (row) row.click();
    expect(onGroupClick).toHaveBeenCalledWith(sampleGroups[0]);
  });

  it('shows loading state', () => {
    renderGroupsTab({ loading: true });
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
