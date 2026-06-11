/**
 * ConflictDialog - Phase K5 412 / 428 conflict-resolution dialog.
 *
 * Shown by `<ResourceDetailDrawer>` when a Save call rejects with
 * status 412 (If-Match did not match - someone else changed the
 * resource since this drawer last loaded it) or 428 (If-Match
 * required by `RequireIfMatch=true` but the resource lacked a
 * `meta.version` to send).
 *
 * Three actions:
 *   - **Refresh and reapply**: re-load the server's current state
 *     into the drawer (preserves the operator's pending edits as
 *     a diff so they can re-confirm).
 *   - **Force overwrite** (only when isForceOverwriteSafe): re-fire
 *     the mutation with `If-Match: *`. Use sparingly - this is the
 *     equivalent of a `git push --force` for the row.
 *   - **Cancel**: dismiss without retrying.
 *
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */
import React from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Text,
  Tooltip,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import {
  ArrowSync20Regular,
  Warning20Filled,
} from '@fluentui/react-icons';
import {
  isForceOverwriteSafe,
  parseResourceEtag,
  type ResourceWithMeta,
} from '../../api/etag';

const useStyles = makeStyles({
  surface: {
    minWidth: '560px',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    color: tokens.colorPaletteYellowForeground1,
    fontSize: '12px',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '12px',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    padding: '8px',
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    borderRadius: tokens.borderRadiusMedium,
    backgroundColor: tokens.colorNeutralBackground3,
  },
  columnTitle: {
    fontWeight: 600,
  },
  pre: {
    margin: 0,
    fontFamily: 'monospace',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    maxHeight: '220px',
    overflow: 'auto',
  },
  etagLine: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: tokens.colorNeutralForeground2,
  },
});

export interface ConflictDialogProps {
  open: boolean;
  /** The pending diff the operator tried to save (just the changed fields). */
  pendingDiff: Record<string, unknown>;
  /** The resource the drawer currently shows (its meta.version is the version we collide against). */
  serverResource: ResourceWithMeta;
  onRefreshAndReapply: () => void;
  onForceOverwrite: () => void;
  onCancel: () => void;
}

export const ConflictDialog: React.FC<ConflictDialogProps> = ({
  open,
  pendingDiff,
  serverResource,
  onRefreshAndReapply,
  onForceOverwrite,
  onCancel,
}) => {
  const classes = useStyles();
  if (!open) return null;

  const parsedEtag = parseResourceEtag(serverResource);
  const showForce = isForceOverwriteSafe(parsedEtag);

  return (
    <Dialog open={open} onOpenChange={(_, d) => { if (!d.open) onCancel(); }} modalType="alert">
      <DialogSurface className={classes.surface} data-testid="conflict-dialog">
        <DialogBody>
          <DialogTitle>Resource changed since you opened it</DialogTitle>
          <DialogContent>
            <div className={classes.body}>
              <div className={classes.banner}>
                <Warning20Filled aria-hidden />
                <Text>
                  Someone else updated this resource between when you loaded it
                  and when you clicked Save. Reload to see their changes, or
                  force-overwrite to discard them.
                </Text>
              </div>
              <div className={classes.columns}>
                <div className={classes.column} data-testid="conflict-pending">
                  <Text className={classes.columnTitle}>Your pending edits</Text>
                  <pre className={classes.pre}>{prettyJson(pendingDiff)}</pre>
                </div>
                <div className={classes.column} data-testid="conflict-server">
                  <Text className={classes.columnTitle}>Server&apos;s current state</Text>
                  <pre className={classes.pre}>{prettyJson(stripVolatile(serverResource))}</pre>
                  {parsedEtag.displayVersion ? (
                    <Text className={classes.etagLine} data-testid="conflict-server-etag">
                      ETag: {parsedEtag.displayVersion}
                    </Text>
                  ) : null}
                </div>
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button appearance="subtle" onClick={onCancel} data-testid="conflict-cancel">
              Cancel
            </Button>
            {showForce ? (
              <Tooltip
                content="Send If-Match: * - your edits will overwrite the server's current state. Use sparingly."
                relationship="label"
              >
                <Button
                  appearance="secondary"
                  onClick={onForceOverwrite}
                  data-testid="conflict-force-overwrite"
                >
                  Force overwrite
                </Button>
              </Tooltip>
            ) : null}
            <Button
              appearance="primary"
              icon={<ArrowSync20Regular />}
              onClick={onRefreshAndReapply}
              data-testid="conflict-refresh"
            >
              Refresh and reapply
            </Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
};

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Strip noisy / unrelated fields from the server resource snapshot
 * shown in the conflict dialog so the operator can focus on the
 * comparison. We keep only the fields most likely to be in `pendingDiff`
 * plus a small set of identifying fields.
 */
function stripVolatile(resource: ResourceWithMeta): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof resource.id === 'string') out.id = resource.id;
  for (const key of Object.keys(resource)) {
    if (key === 'id' || key === 'schemas' || key === 'meta') continue;
    out[key] = (resource as Record<string, unknown>)[key];
  }
  return out;
}
