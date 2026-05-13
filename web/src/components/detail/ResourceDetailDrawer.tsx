/**
 * ResourceDetailDrawer - shared drawer for editing/deleting a SCIM
 * User or Group from inside UsersTab / GroupsTab (Phase E4).
 *
 * The drawer wraps the C1 `DetailDrawer` primitive so the slide-in
 * + sticky header/footer + close-on-ESC behavior is consistent with
 * the rest of the redesigned UI (LogsPage, future endpoint detail).
 *
 * Behavior:
 *   - Renders read-only metadata (id, meta.created, meta.lastModified)
 *   - Pre-fills the writable attributes:
 *       User  -> userName, displayName, active
 *       Group -> displayName, externalId, members (count read-only)
 *   - Save builds a real SCIM PATCH body
 *       { schemas: [...PatchOp], Operations: [{ op: 'replace', path, value }] }
 *     containing only fields the user actually changed (no-op skipped).
 *     Wired to `useUpdateUser` / `useUpdateGroup` (Phase C5/F3 - already
 *     optimistic against every cached list page).
 *   - Delete shows a confirm step inline (no second modal); the
 *     confirm button fires `useDeleteUser` / `useDeleteGroup` then
 *     calls `onClose()` so the drawer dismisses.
 *
 * The kind discriminator drives both the field set and which mutation
 * hook is used. Both hooks are always invoked (rules of hooks); only
 * the kind-matched one is actually called via mutateAsync.
 */
import React from 'react';
import {
  makeStyles,
  tokens,
  Field,
  Input,
  Switch,
  Button,
  Caption1,
  Subtitle2,
  Text,
  Badge,
} from '@fluentui/react-components';
import {
  Save24Regular,
  Delete24Regular,
} from '@fluentui/react-icons';
import { DetailDrawer } from '../primitives/DetailDrawer';
import { ScimErrorMessage } from '../primitives/ScimErrorMessage';
import { EtagBadge } from '../primitives/EtagBadge';
import { ConflictDialog } from '../primitives/ConflictDialog';
import {
  formatIfMatchValue,
  parseResourceEtag,
  FORCE_OVERWRITE_IF_MATCH,
} from '../../api/etag';
import { ScimApiError } from '../../api/scim-error';
import {
  useUpdateUser,
  useDeleteUser,
  useUpdateGroup,
  useDeleteGroup,
} from '../../api/queries';

const SCIM_PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

const useStyles = makeStyles({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  metaRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '4px 0',
    gap: '12px',
  },
  metaLabel: { color: tokens.colorNeutralForeground3 },
  monospace: { fontFamily: 'monospace', fontSize: '12px' },
  switchRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: '4px',
  },
  confirmBlock: {
    border: `1px solid ${tokens.colorPaletteRedBorder1}`,
    backgroundColor: tokens.colorPaletteRedBackground1,
    color: tokens.colorPaletteRedForeground1,
    padding: '8px',
    borderRadius: tokens.borderRadiusMedium,
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  footerLeft: { marginRight: 'auto' },
  footerRight: { display: 'flex', gap: '8px' },
});

// ─── Resource shape (loose, mirrors what the SCIM list returns) ─────

interface ScimResource {
  id: string;
  userName?: string;
  displayName?: string;
  externalId?: string;
  active?: boolean;
  members?: Array<{ value?: string }>;
  meta?: {
    created?: string;
    lastModified?: string;
  };
  [key: string]: unknown;
}

export type ResourceKind = 'user' | 'group';

export interface ResourceDetailDrawerProps {
  kind: ResourceKind;
  endpointId: string;
  resource: ScimResource;
  open: boolean;
  onClose: () => void;
}

// ─── Helper: build a SCIM PATCH op array from a diff ────────────────

function buildOperations(
  diff: Record<string, unknown>,
): Array<{ op: 'replace'; path: string; value: unknown }> {
  return Object.entries(diff).map(([path, value]) => ({
    op: 'replace',
    path,
    value,
  }));
}

// ─── Component ───────────────────────────────────────────────────────

export const ResourceDetailDrawer: React.FC<ResourceDetailDrawerProps> = ({
  kind,
  endpointId,
  resource,
  open,
  onClose,
}) => {
  const classes = useStyles();
  // Always call both hooks (rules of hooks). Only the kind-matched one
  // is invoked via mutateAsync.
  const userUpdate = useUpdateUser(endpointId);
  const userDelete = useDeleteUser(endpointId);
  const groupUpdate = useUpdateGroup(endpointId);
  const groupDelete = useDeleteGroup(endpointId);

  // Editable form state - re-seeded whenever `resource` changes.
  const [userName, setUserName] = React.useState(resource.userName ?? '');
  const [displayName, setDisplayName] = React.useState(resource.displayName ?? '');
  const [externalId, setExternalId] = React.useState(resource.externalId ?? '');
  const [active, setActive] = React.useState(resource.active ?? true);
  const [confirming, setConfirming] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);
  // K5 - separate state for the 412/428 conflict dialog. We surface
  // those via <ConflictDialog /> instead of the generic
  // <ScimErrorMessage /> because the operator's recovery path is
  // different (refresh-and-reapply vs. force-overwrite vs. cancel).
  const [conflict, setConflict] = React.useState<{ pending: Record<string, unknown> } | null>(null);

  // Reset form whenever a different resource is loaded into the drawer.
  React.useEffect(() => {
    setUserName(resource.userName ?? '');
    setDisplayName(resource.displayName ?? '');
    setExternalId(resource.externalId ?? '');
    setActive(resource.active ?? true);
    setConfirming(false);
    setError(null);
    setConflict(null);
  }, [resource.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function buildDiff(): Record<string, unknown> {
    const diff: Record<string, unknown> = {};
    if (kind === 'user') {
      if (userName !== (resource.userName ?? '')) diff.userName = userName;
      if (displayName !== (resource.displayName ?? '')) diff.displayName = displayName;
      if (active !== (resource.active ?? true)) diff.active = active;
    } else {
      if (displayName !== (resource.displayName ?? '')) diff.displayName = displayName;
      if (externalId !== (resource.externalId ?? '')) diff.externalId = externalId;
    }
    return diff;
  }

  async function handleSave(overrideIfMatch?: string) {
    setError(null);
    const diff = buildDiff();
    if (Object.keys(diff).length === 0) {
      onClose();
      return;
    }
    const body = {
      schemas: [SCIM_PATCH_OP_SCHEMA],
      Operations: buildOperations(diff),
    };
    // K5 - send the resource's current ETag as If-Match. Server uses
    // it to detect mid-air collisions (412 Precondition Failed when
    // the server already moved on, 428 Precondition Required when
    // RequireIfMatch=true and we have no ETag to send).
    const ifMatch = overrideIfMatch ?? formatIfMatchValue(parseResourceEtag(resource));
    try {
      if (kind === 'user') {
        await userUpdate.mutateAsync({ userId: resource.id, body, ifMatch });
      } else {
        await groupUpdate.mutateAsync({ groupId: resource.id, body, ifMatch });
      }
      setConflict(null);
      onClose();
    } catch (err) {
      // K5 - 412 / 428 = collision. Surface ConflictDialog instead of
      // the generic error banner. Everything else falls through to
      // <ScimErrorMessage /> via setError.
      if (err instanceof ScimApiError && (err.status === 412 || err.status === 428)) {
        setConflict({ pending: diff });
        return;
      }
      // K3 - keep the raw error so ScimErrorMessage can map scimType
      // to a plain-English explanation; legacy `err.message` is still
      // available since ScimApiError extends Error.
      setError(err);
    }
  }

  async function handleDeleteConfirmed() {
    setError(null);
    try {
      if (kind === 'user') {
        await userDelete.mutateAsync(resource.id);
      } else {
        await groupDelete.mutateAsync(resource.id);
      }
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  const saving = kind === 'user' ? userUpdate.isPending : groupUpdate.isPending;
  const deleting = kind === 'user' ? userDelete.isPending : groupDelete.isPending;

  const title = kind === 'user'
    ? `User - ${resource.userName ?? resource.id}`
    : `Group - ${resource.displayName ?? resource.id}`;

  const footer = (
    <>
      <div className={classes.footerLeft}>
        {!confirming ? (
          <Button
            appearance="subtle"
            icon={<Delete24Regular />}
            onClick={() => setConfirming(true)}
            disabled={saving || deleting}
          >
            Delete
          </Button>
        ) : (
          <div className={classes.confirmBlock} data-testid="confirm-delete">
            <Text weight="semibold">Permanently delete this {kind}?</Text>
            <div className={classes.footerRight}>
              <Button appearance="subtle" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={handleDeleteConfirmed}
                disabled={deleting}
              >
                Confirm delete
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className={classes.footerRight}>
        <Button appearance="subtle" onClick={onClose} disabled={saving || deleting}>
          Cancel
        </Button>
        <Button
          appearance="primary"
          icon={<Save24Regular />}
          onClick={() => void handleSave()}
          disabled={saving || deleting}
        >
          Save
        </Button>
      </div>
    </>
  );

  return (
    <DetailDrawer
      open={open}
      onClose={onClose}
      title={title}
      width="520px"
      footer={footer}
      data-testid="resource-detail-drawer"
    >
      <div className={classes.body}>
        {/* ── Read-only metadata card ──────────────────────────── */}
        <Caption1>Identity</Caption1>
        <div className={classes.metaRow}>
          <Caption1 className={classes.metaLabel}>id</Caption1>
          <Caption1 className={classes.monospace}>{resource.id}</Caption1>
        </div>
        <div className={classes.metaRow}>
          <Caption1 className={classes.metaLabel}>Created</Caption1>
          <Caption1>{resource.meta?.created ?? '-'}</Caption1>
        </div>
        <div className={classes.metaRow}>
          <Caption1 className={classes.metaLabel}>Last modified</Caption1>
          <Caption1>{resource.meta?.lastModified ?? '-'}</Caption1>
        </div>
        {/* K5 - ETag badge in the metadata card. Renders nothing
            when the server never sent meta.version. */}
        <div className={classes.metaRow}>
          <Caption1 className={classes.metaLabel}>Version</Caption1>
          <EtagBadge resource={resource} />
        </div>

        {/* ── Editable fields ──────────────────────────────────── */}
        <Subtitle2>Attributes</Subtitle2>

        {kind === 'user' ? (
          <>
            <Field label="userName">
              <Input value={userName} onChange={(_, d) => setUserName(d.value)} />
            </Field>
            <Field label="displayName">
              <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
            </Field>
            <div className={classes.switchRow}>
              <Text>active</Text>
              <Switch
                aria-label="active"
                checked={active}
                onChange={(_, d) => setActive(d.checked)}
              />
            </div>
          </>
        ) : (
          <>
            <Field label="displayName">
              <Input value={displayName} onChange={(_, d) => setDisplayName(d.value)} />
            </Field>
            <Field label="externalId">
              <Input value={externalId} onChange={(_, d) => setExternalId(d.value)} />
            </Field>
            <div className={classes.metaRow}>
              <Caption1 className={classes.metaLabel}>Membership</Caption1>
              <Badge appearance="outline">{resource.members?.length ?? 0} members</Badge>
            </div>
          </>
        )}

        {error !== null && error !== undefined ? (
          <ScimErrorMessage error={error} data-testid="drawer-error" />
        ) : null}
      </div>
      {/* K5 - mid-air collision dialog. Mounted as sibling so its
          backdrop sits above the drawer's body. */}
      <ConflictDialog
        open={conflict !== null}
        pendingDiff={conflict?.pending ?? {}}
        serverResource={resource}
        onCancel={() => setConflict(null)}
        onRefreshAndReapply={() => {
          // Re-seed the form with the current resource snapshot so
          // the operator can review server values then re-Save. We
          // do NOT auto-fire the mutation - the user picks which
          // edits to keep.
          setUserName(resource.userName ?? '');
          setDisplayName(resource.displayName ?? '');
          setExternalId(resource.externalId ?? '');
          setActive(resource.active ?? true);
          setConflict(null);
        }}
        onForceOverwrite={() => {
          setConflict(null);
          void handleSave(FORCE_OVERWRITE_IF_MATCH);
        }}
      />
    </DetailDrawer>
  );
};
