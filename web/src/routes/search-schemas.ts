/**
 * search-schemas.ts - URL search-param schemas for type-safe routes.
 *
 * Defines zod schemas consumed by TanStack Router routes (Phase A3) so that
 * pagination, filters, and time-range selectors live in the URL rather than
 * React state. URL becomes the single source of truth for view state, which:
 *   - Makes views shareable / bookmarkable / deep-linkable
 *   - Survives browser refresh
 *   - Removes the need for ad-hoc `useState` + popstate juggling
 *   - Lets TanStack Router run loaders in parallel with renders
 *
 * Each schema is also exported as a TypeScript type so callers (route
 * components and the queries layer) get compile-time safety.
 *
 * Conventions:
 *   - `page` is 1-indexed (UI convention, matches what users see)
 *   - `pageSize` capped at 100 to match server-side `count` max
 *   - Empty string filter values are normalized to `undefined` (clean URL)
 *   - All schemas use `z.coerce` because URL search params arrive as strings
 *   - `.optional()` + transform empty -> undefined keeps URLs minimal
 */

import { z } from 'zod';

/** Allowed values for the global logs page time-range filter. */
export const TIME_RANGE_VALUES = ['1h', '24h', '7d', '30d', 'custom'] as const;
export type TimeRange = (typeof TIME_RANGE_VALUES)[number];

const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

/**
 * Base pagination schema used by every list view.
 * page is 1-indexed; pageSize is capped to align with the server-side
 * `count` ceiling.
 */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type PaginationSearch = z.infer<typeof paginationSchema>;

/** Users tab inside an endpoint: pagination + optional SCIM filter + drawer detail id. */
export const usersSearchSchema = paginationSchema.extend({
  filter: z.preprocess(emptyToUndef, z.string().optional()),
  /** Phase E4: id of the user whose detail drawer is open. */
  detail: z.preprocess(emptyToUndef, z.string().optional()),
});
export type UsersSearch = z.infer<typeof usersSearchSchema>;

/** Groups tab inside an endpoint: pagination + optional SCIM filter + drawer detail id. */
export const groupsSearchSchema = paginationSchema.extend({
  filter: z.preprocess(emptyToUndef, z.string().optional()),
  /** Phase E4: id of the group whose detail drawer is open. */
  detail: z.preprocess(emptyToUndef, z.string().optional()),
});
export type GroupsSearch = z.infer<typeof groupsSearchSchema>;

/**
 * Per-endpoint Logs tab: pagination + optional URL substring filter.
 * The server interprets `urlContains` as a case-insensitive contains
 * match against the request URL.
 */
export const logsSearchSchema = paginationSchema.extend({
  urlContains: z.preprocess(emptyToUndef, z.string().optional()),
});
export type LogsSearch = z.infer<typeof logsSearchSchema>;

/**
 * Global Logs page (across all endpoints): pagination + endpoint filter +
 * status code filter + time range + URL substring filter.
 *
 * `status` is coerced to number because URL search params are strings.
 * `timeRange` is a closed enum to prevent typo-driven divergence between
 * the UI and the server's accepted set.
 *
 * Phase D5 adds `detail` (the id of a log row whose body/headers should
 * be shown in the slide-over DetailDrawer). Empty / missing means no
 * drawer is open.
 */
export const globalLogsSearchSchema = paginationSchema.extend({
  endpointId: z.preprocess(emptyToUndef, z.string().optional()),
  status: z.preprocess(emptyToUndef, z.coerce.number().int().min(100).max(599).optional()),
  timeRange: z.preprocess(emptyToUndef, z.enum(TIME_RANGE_VALUES).optional()),
  urlContains: z.preprocess(emptyToUndef, z.string().optional()),
  detail: z.preprocess(emptyToUndef, z.string().optional()),
});
export type GlobalLogsSearch = z.infer<typeof globalLogsSearchSchema>;

/**
 * Endpoints listing page: optional search query.
 * No pagination - the endpoint list is always small (<100 in practice)
 * and the page already supports client-side filtering for snappiness.
 */
export const endpointsSearchSchema = z.object({
  q: z.preprocess(emptyToUndef, z.string().optional()),
});
export type EndpointsSearch = z.infer<typeof endpointsSearchSchema>;

/**
 * Per-endpoint Activity tab (Phase D2): pagination + optional
 * type/severity/search filters. The activity controller's `type` is
 * limited to the ActivitySummary union (`user` | `group` | `system`)
 * and `severity` to (`info` | `success` | `warning` | `error`); we
 * preserve those server-side enums here as a closed set so the UI
 * cannot construct a request the controller will silently filter to
 * zero results.
 */
export const ACTIVITY_TYPE_VALUES = ['user', 'group', 'system'] as const;
export type ActivityType = (typeof ACTIVITY_TYPE_VALUES)[number];
export const ACTIVITY_SEVERITY_VALUES = ['info', 'success', 'warning', 'error'] as const;
export type ActivitySeverity = (typeof ACTIVITY_SEVERITY_VALUES)[number];

export const activitySearchSchema = paginationSchema.extend({
  type: z.preprocess(emptyToUndef, z.enum(ACTIVITY_TYPE_VALUES).optional()),
  severity: z.preprocess(emptyToUndef, z.enum(ACTIVITY_SEVERITY_VALUES).optional()),
  search: z.preprocess(emptyToUndef, z.string().optional()),
});
export type ActivitySearch = z.infer<typeof activitySearchSchema>;
