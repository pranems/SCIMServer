/**
 * ResourceDetailDrawer tests (Phase E4).
 *
 * The drawer is shared between UsersTab and GroupsTab (discriminated by
 * `kind: 'user' | 'group'`). It renders read-only metadata (id, meta.created,
 * meta.lastModified) plus an editable form for the writable attributes,
 * a Save button wired to useUpdateUser/useUpdateGroup, and a Delete button
 * (with a confirm step) wired to useDeleteUser/useDeleteGroup.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FluentProvider, webLightTheme } from '@fluentui/react-components';
import { ResourceDetailDrawer } from './ResourceDetailDrawer';

vi.mock('../../api/queries', async () => {
  const actual = await vi.importActual('../../api/queries');
  return {
    ...actual,
    useUpdateUser: vi.fn(),
    useDeleteUser: vi.fn(),
    useUpdateGroup: vi.fn(),
    useDeleteGroup: vi.fn(),
  };
});

import {
  useUpdateUser,
  useDeleteUser,
  useUpdateGroup,
  useDeleteGroup,
} from '../../api/queries';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </QueryClientProvider>,
  );
}

const USER = {
  id: 'u-1',
  userName: 'alice@corp.com',
  displayName: 'Alice Smith',
  active: true,
  meta: {
    resourceType: 'User',
    created: '2026-01-01T00:00:00Z',
    lastModified: '2026-05-01T00:00:00Z',
  },
};

const GROUP = {
  id: 'g-1',
  displayName: 'Engineering',
  externalId: 'ext-eng',
  members: [{ value: 'u-1' }, { value: 'u-2' }],
  meta: {
    resourceType: 'Group',
    created: '2026-02-01T00:00:00Z',
    lastModified: '2026-05-01T00:00:00Z',
  },
};

describe('ResourceDetailDrawer (User)', () => {
  let updateUser: ReturnType<typeof vi.fn>;
  let deleteUser: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateUser = vi.fn().mockResolvedValue({});
    deleteUser = vi.fn().mockResolvedValue({});
    (useUpdateUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: updateUser, isPending: false, error: null,
    });
    (useDeleteUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: deleteUser, isPending: false, error: null,
    });
    // Group hooks aren't called for kind=user but the mock still has to return
    // a stable shape because the component invokes both hooks (rules of hooks).
    (useUpdateGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(), isPending: false, error: null,
    });
    (useDeleteGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(), isPending: false, error: null,
    });
  });

  it('renders the read-only metadata fields (id, created, lastModified)', () => {
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(USER.id)).toBeInTheDocument();
    expect(screen.getByText(/Created/i)).toBeInTheDocument();
    expect(screen.getByText(/Last modified/i)).toBeInTheDocument();
  });

  it('pre-fills userName and displayName fields', () => {
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    expect((screen.getByLabelText(/userName/i) as HTMLInputElement).value).toBe(USER.userName);
    expect((screen.getByLabelText(/displayName/i) as HTMLInputElement).value).toBe(USER.displayName);
  });

  it('Save fires useUpdateUser PATCH (SCIM Operations envelope) with only changed fields', async () => {
    const user = userEvent.setup();
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'Alice Updated' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    expect(useUpdateUser as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ep-1');
    expect(updateUser).toHaveBeenCalledTimes(1);
    const args = updateUser.mock.calls[0][0] as { userId: string; body: Record<string, unknown> };
    expect(args.userId).toBe('u-1');
    expect(args.body.schemas).toEqual(['urn:ietf:params:scim:api:messages:2.0:PatchOp']);
    const ops = args.body.Operations as Array<{ op: string; path: string; value: unknown }>;
    expect(ops).toEqual([{ op: 'replace', path: 'displayName', value: 'Alice Updated' }]);
  });

  it('toggling active and saving sends a replace op for active', async () => {
    const user = userEvent.setup();
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    await user.click(screen.getByRole('switch', { name: /active/i }));
    await user.click(screen.getByRole('button', { name: /Save/i }));
    const args = updateUser.mock.calls[0][0] as { body: Record<string, unknown> };
    const ops = args.body.Operations as Array<{ op: string; path: string; value: unknown }>;
    expect(ops).toContainEqual({ op: 'replace', path: 'active', value: false });
  });

  it('Delete asks for confirmation before invoking useDeleteUser', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={onClose}
      />,
    );
    // First click reveals confirm; doesn't yet delete.
    await user.click(screen.getByRole('button', { name: /Delete/i }));
    expect(deleteUser).not.toHaveBeenCalled();
    expect(screen.getByTestId('confirm-delete')).toBeInTheDocument();
    // Second click confirms.
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    expect(deleteUser).toHaveBeenCalledWith('u-1');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('shows an error MessageBar when Save rejects', async () => {
    const user = userEvent.setup();
    updateUser.mockRejectedValueOnce(new Error('HTTP 409'));
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'X' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      expect(screen.getByTestId('drawer-error')).toBeInTheDocument();
    });
  });
});

describe('ResourceDetailDrawer (Group)', () => {
  let updateGroup: ReturnType<typeof vi.fn>;
  let deleteGroup: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    updateGroup = vi.fn().mockResolvedValue({});
    deleteGroup = vi.fn().mockResolvedValue({});
    (useUpdateUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(), isPending: false, error: null,
    });
    (useDeleteUser as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: vi.fn(), isPending: false, error: null,
    });
    (useUpdateGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: updateGroup, isPending: false, error: null,
    });
    (useDeleteGroup as ReturnType<typeof vi.fn>).mockReturnValue({
      mutateAsync: deleteGroup, isPending: false, error: null,
    });
  });

  it('pre-fills displayName + externalId for a group', () => {
    wrap(
      <ResourceDetailDrawer
        kind="group"
        endpointId="ep-1"
        resource={GROUP}
        open
        onClose={() => undefined}
      />,
    );
    expect((screen.getByLabelText(/displayName/i) as HTMLInputElement).value).toBe(GROUP.displayName);
    expect((screen.getByLabelText(/externalId/i) as HTMLInputElement).value).toBe(GROUP.externalId);
  });

  it('renders member count read-only', () => {
    wrap(
      <ResourceDetailDrawer
        kind="group"
        endpointId="ep-1"
        resource={GROUP}
        open
        onClose={() => undefined}
      />,
    );
    expect(screen.getByText(/2 members/i)).toBeInTheDocument();
  });

  it('Save fires useUpdateGroup with a SCIM Operations envelope', async () => {
    const user = userEvent.setup();
    wrap(
      <ResourceDetailDrawer
        kind="group"
        endpointId="ep-1"
        resource={GROUP}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'Engineering Renamed' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    expect(useUpdateGroup as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('ep-1');
    const args = updateGroup.mock.calls[0][0] as { groupId: string; body: Record<string, unknown> };
    expect(args.groupId).toBe('g-1');
    const ops = args.body.Operations as Array<{ op: string; path: string; value: unknown }>;
    expect(ops).toEqual([{ op: 'replace', path: 'displayName', value: 'Engineering Renamed' }]);
  });

  it('Delete asks for confirmation before invoking useDeleteGroup', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(
      <ResourceDetailDrawer
        kind="group"
        endpointId="ep-1"
        resource={GROUP}
        open
        onClose={onClose}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Delete/i }));
    expect(deleteGroup).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Confirm delete/i }));
    expect(deleteGroup).toHaveBeenCalledWith('g-1');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
