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

  // Finding-D follow-up (2026-05-29): operator caught that the drawer
  // rendered ONLY userName + displayName + active even when the SCIM
  // resource carried name.familyName, emails[0].value, externalId, and
  // an enterprise extension (employeeNumber). All non-editable fields
  // MUST be rendered read-only so the operator can SEE the full SCIM
  // record without having to dig into the raw JSON tab. The drawer is
  // the canonical "what does this user look like" surface in the UI.
  it('renders read-only rows for every non-editable top-level attribute (name, emails, externalId, enterprise extension)', () => {
    const richUser = {
      id: 'u-rich',
      userName: 'rich@corp.com',
      displayName: 'Rich User',
      externalId: 'ext-rich-1234',
      active: true,
      name: { familyName: 'User', givenName: 'Rich', formatted: 'Rich User' },
      emails: [{ type: 'work', value: 'rich@corp.com', primary: true }],
      'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': {
        employeeNumber: 'EMP-001',
        department: 'Engineering',
      },
      meta: { resourceType: 'User', created: '2026-01-01T00:00:00Z', lastModified: '2026-05-01T00:00:00Z' },
    };
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={richUser}
        open
        onClose={() => undefined}
      />,
    );
    // Each surfaced row carries data-testid="attr-<key>" so specs can
    // assert presence without coupling to layout. Section heading
    // "Additional attributes" anchors the read-only block.
    expect(screen.getByText(/Additional attributes/i)).toBeInTheDocument();
    expect(screen.getByTestId('attr-externalId')).toBeInTheDocument();
    expect(screen.getByTestId('attr-externalId').textContent).toMatch(/ext-rich-1234/);
    expect(screen.getByTestId('attr-name')).toBeInTheDocument();
    expect(screen.getByTestId('attr-name').textContent).toMatch(/familyName/);
    expect(screen.getByTestId('attr-name').textContent).toMatch(/Rich/);
    expect(screen.getByTestId('attr-emails')).toBeInTheDocument();
    expect(screen.getByTestId('attr-emails').textContent).toMatch(/rich@corp\.com/);
    expect(
      screen.getByTestId('attr-urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('attr-urn:ietf:params:scim:schemas:extension:enterprise:2.0:User').textContent,
    ).toMatch(/EMP-001/);
  });

  it('omits the Additional attributes section when the resource has only the editable fields', () => {
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    expect(screen.queryByText(/Additional attributes/i)).not.toBeInTheDocument();
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
    await user.click(screen.getByRole('switch', { name: /active/i, hidden: true }));
    await user.click(screen.getByRole('button', { name: /Save/i, hidden: true }));
    await waitFor(() => expect(updateUser).toHaveBeenCalledTimes(1));
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
    await user.click(screen.getByRole('button', { name: /Delete/i, hidden: true }));
    expect(deleteUser).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeInTheDocument());
    // Second click confirms.
    await user.click(screen.getByRole('button', { name: /Confirm delete/i, hidden: true }));
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('u-1'));
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

  // ─── Phase K5 - ETag surface + 412 conflict + force overwrite ─────

  it('K5 - renders the ETag badge in the metadata section', () => {
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={{ ...USER, meta: { ...USER.meta, version: 'W/"v3"' } }}
        open
        onClose={() => undefined}
      />,
    );
    const badge = screen.getByTestId('etag-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('v3');
  });

  it('K5 - forwards the parsed ETag as If-Match on Save', async () => {
    const user = userEvent.setup();
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={{ ...USER, meta: { ...USER.meta, version: 'W/"v7"' } }}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'New' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    expect(updateUser).toHaveBeenCalledWith(
      expect.objectContaining({ ifMatch: 'W/"v7"' }),
    );
  });

  it('K5 - on 412 the ConflictDialog opens (not the generic ScimErrorMessage)', async () => {
    const user = userEvent.setup();
    const { ScimApiError } = await import('../../api/scim-error');
    updateUser.mockRejectedValueOnce(new ScimApiError({
      status: 412,
      scimType: 'versionMismatch',
      detail: 'If-Match did not match',
      rawBody: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '412' },
    }));
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={{ ...USER, meta: { ...USER.meta, version: 'W/"v7"' } }}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'New' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      expect(screen.getByTestId('conflict-dialog')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('drawer-error')).toBeNull();
  });

  it('K5 - Force overwrite from the conflict dialog re-fires the mutation with If-Match=*', async () => {
    const user = userEvent.setup();
    const { ScimApiError } = await import('../../api/scim-error');
    updateUser
      .mockRejectedValueOnce(new ScimApiError({
        status: 412, scimType: 'versionMismatch', detail: 'collision',
        rawBody: { status: '412' },
      }))
      .mockResolvedValueOnce({});
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        resource={{ ...USER, meta: { ...USER.meta, version: 'W/"v7"' } }}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'New' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      expect(screen.getByTestId('conflict-dialog')).toBeInTheDocument();
    });
    await user.click(screen.getByTestId('conflict-force-overwrite'));
    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledTimes(2);
    });
    expect(updateUser.mock.calls[1][0]).toEqual(
      expect.objectContaining({ ifMatch: '*' }),
    );
  });

  it('K5 - on 428 (RequireIfMatch missing) the ConflictDialog also opens (server signals the operator must reload)', async () => {
    const user = userEvent.setup();
    const { ScimApiError } = await import('../../api/scim-error');
    updateUser.mockRejectedValueOnce(new ScimApiError({
      status: 428,
      detail: 'If-Match required',
    }));
    wrap(
      <ResourceDetailDrawer
        kind="user"
        endpointId="ep-1"
        // Resource lacks meta.version on purpose - the drawer cannot
        // synthesise an If-Match, server returns 428.
        resource={USER}
        open
        onClose={() => undefined}
      />,
    );
    const display = screen.getByLabelText(/displayName/i) as HTMLInputElement;
    fireEvent.change(display, { target: { value: 'New' } });
    await user.click(screen.getByRole('button', { name: /Save/i }));
    await waitFor(() => {
      expect(screen.getByTestId('conflict-dialog')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: /Delete/i, hidden: true }));
    expect(deleteGroup).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('confirm-delete')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /Confirm delete/i, hidden: true }));
    await waitFor(() => expect(deleteGroup).toHaveBeenCalledWith('g-1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
