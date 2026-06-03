/**
 * Custom design tokens for SCIMServer UI.
 *
 * Extends Fluent UI tokens with app-specific spacing, layout, and color values.
 * All values reference Fluent tokens where possible for consistency.
 */

/** Sidebar widths */
export const SIDEBAR_WIDTH_EXPANDED = '240px';
export const SIDEBAR_WIDTH_COLLAPSED = '48px';

/** App shell layout dimensions */
export const HEADER_HEIGHT = '48px';
export const CONTENT_MAX_WIDTH = '1400px';
export const CONTENT_PADDING = '24px';

/** Card grid responsive breakpoints */
export const BREAKPOINT_SM = '640px';
export const BREAKPOINT_MD = '768px';
export const BREAKPOINT_LG = '1024px';
export const BREAKPOINT_XL = '1280px';

/** Activity/log list defaults */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

/** Status indicator colors (semantic) */
export const STATUS_COLORS = {
  healthy: '#0E7A0D',
  warning: '#C4A000',
  error: '#BC2F32',
  inactive: '#8A8886',
} as const;
