/**
 * Re-export barrel for primitives. Lets callers do
 * `import { EmptyState, DetailDrawer } from '../components/primitives'`
 * instead of N separate imports per file.
 */
export { DetailDrawer } from './DetailDrawer';
export type { DetailDrawerProps } from './DetailDrawer';

export { FormDialog } from './FormDialog';
export type { FormDialogProps } from './FormDialog';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { LoadingSkeleton } from './LoadingSkeleton';
export type { LoadingSkeletonProps } from './LoadingSkeleton';

export { ErrorBoundary } from './ErrorBoundary';
export type { ErrorBoundaryProps } from './ErrorBoundary';

export { KpiChart } from './KpiChart';
export type { KpiChartProps } from './KpiChart';

export { ScimErrorMessage } from './ScimErrorMessage';
export type { ScimErrorMessageProps } from './ScimErrorMessage';

export { EtagBadge } from './EtagBadge';
export type { EtagBadgeProps } from './EtagBadge';

export { ConflictDialog } from './ConflictDialog';
export type { ConflictDialogProps } from './ConflictDialog';

export { ExportSplitButton } from './ExportSplitButton';
export type { ExportSplitButtonProps } from './ExportSplitButton';
