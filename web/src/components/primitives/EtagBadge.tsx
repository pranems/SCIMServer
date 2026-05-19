/**
 * EtagBadge - Phase K5 small monospace badge that surfaces the
 * resource's `meta.version` (`v3`) or the legacy ETag string for
 * pre-v0.16.0 timestamp ETags.
 *
 * Renders nothing when no ETag is present on the resource.
 *
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */
import React from 'react';
import { Badge, Tooltip, makeStyles, tokens } from '@fluentui/react-components';
import { parseResourceEtag, type ResourceWithMeta } from '../../api/etag';

const useStyles = makeStyles({
  badge: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: tokens.colorNeutralForeground2,
  },
});

export interface EtagBadgeProps {
  resource: ResourceWithMeta | null | undefined;
}

export const EtagBadge: React.FC<EtagBadgeProps> = ({ resource }) => {
  const classes = useStyles();
  const parsed = parseResourceEtag(resource);
  if (parsed.kind === 'missing' || parsed.displayVersion === null) return null;

  const ariaLabel = `ETag ${parsed.displayVersion}`;
  return (
    <Tooltip content={`ETag (resource version): ${parsed.rawEtag ?? parsed.displayVersion}`} relationship="label">
      <Badge
        appearance="outline"
        size="small"
        className={classes.badge}
        data-testid="etag-badge"
        aria-label={ariaLabel}
      >
        {parsed.displayVersion}
      </Badge>
    </Tooltip>
  );
};
