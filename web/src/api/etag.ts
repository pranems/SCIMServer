/**
 * etag.ts - Phase K5 ETag parsing + force-overwrite policy.
 *
 * The SCIM server emits weak ETags via `meta.version` in the
 * canonical `W/"v{N}"` form (Phase 7). Older deployments and some
 * adjacent SCIM servers emit timestamp-style ETags (`W/"<ISO>"`),
 * so the parser is tolerant of both shapes. The result type
 * (`ParsedEtag`) discriminates with a `kind` so callers can render
 * the right UI - we display the version number when known and fall
 * back to the raw display string for legacy ETags.
 *
 * Pure functions - no React, no fetch.
 *
 * @see docs/UI_NEXT_GAPS_LATERAL_ANALYSIS_2026.md S4.10
 * @see docs/PHASE_K5_ETAG_AND_REQUIREIFMATCH.md
 */

/**
 * Minimal SCIM resource shape this module reads. Caller passes the
 * SCIM resource as-typed - it only inspects `meta.version`.
 */
export interface ResourceWithMeta {
  id?: string;
  meta?: {
    version?: string;
    created?: string;
    lastModified?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Discriminated parser result. */
export interface ParsedEtag {
  /** The raw ETag string the server returned (verbatim, used for If-Match). */
  rawEtag: string | null;
  /** Numeric version when the ETag is `W/"v{N}"` form; null otherwise. */
  versionNumber: number | null;
  /** Operator-readable display value (`v3`, ISO timestamp, etc.). */
  displayVersion: string | null;
  /** Discriminator: 'version' = `W/"vN"`, 'legacy' = anything else, 'missing' = no ETag. */
  kind: 'version' | 'legacy' | 'missing';
}

/**
 * Strip the optional `W/` weak-validator prefix and the surrounding
 * double quotes from a raw ETag string. Returns null for nullable
 * inputs.
 */
function unwrapEtag(value: string | undefined | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Strip leading W/ then strip surrounding "..."
  const noWeak = trimmed.startsWith('W/') ? trimmed.slice(2) : trimmed;
  if (noWeak.startsWith('"') && noWeak.endsWith('"')) {
    return noWeak.slice(1, -1);
  }
  return noWeak;
}

/** Parse a SCIM resource into the ETag shape the UI needs. */
export function parseResourceEtag(resource: ResourceWithMeta | null | undefined): ParsedEtag {
  if (!resource || typeof resource !== 'object') {
    return { rawEtag: null, versionNumber: null, displayVersion: null, kind: 'missing' };
  }
  const raw = resource.meta?.version;
  if (typeof raw !== 'string' || raw.length === 0) {
    return { rawEtag: null, versionNumber: null, displayVersion: null, kind: 'missing' };
  }
  const inner = unwrapEtag(raw);
  if (!inner) {
    return { rawEtag: raw, versionNumber: null, displayVersion: null, kind: 'legacy' };
  }
  const versionMatch = /^v(\d+)$/.exec(inner);
  if (versionMatch) {
    return {
      rawEtag: raw,
      versionNumber: Number(versionMatch[1]),
      displayVersion: inner,
      kind: 'version',
    };
  }
  // Legacy / timestamp ETag - we can still send it back as If-Match.
  return {
    rawEtag: raw,
    versionNumber: null,
    displayVersion: inner,
    kind: 'legacy',
  };
}

/**
 * Returns the raw ETag string (suitable for `If-Match`) or undefined
 * when no ETag is available on the resource.
 */
export function formatIfMatchValue(parsed: ParsedEtag): string | undefined {
  return parsed.rawEtag ?? undefined;
}

/**
 * Policy: force-overwrite (`If-Match: *`) is only ever offered to
 * the operator when we actually have an ETag for the resource. The
 * absence of an ETag means we can not reason about who last touched
 * the row, so silently sending `*` would be a footgun.
 */
export function isForceOverwriteSafe(parsed: ParsedEtag): boolean {
  return parsed.kind !== 'missing';
}

/** Constant the drawer/dialog send when the operator chose to force the write. */
export const FORCE_OVERWRITE_IF_MATCH = '*' as const;
