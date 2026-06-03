/**
 * App.tsx - root entry point.
 *
 * Phase I1 (v0.48.0 cutover): the legacy `?ui=legacy` opt-in escape
 * hatch + the entire pre-redesign tab-based AppContent + the
 * Header/LogList/LogDetail/LogFilters/AuthProvider/ThemeProvider tree
 * have been deleted. The TanStack Router instance from
 * [./router.ts](./router.ts) is the single source of truth for view
 * state.
 *
 * What used to be here (deleted in Phase I2):
 *   - 670 LoC of tab state machine + ad-hoc fetch wiring + version
 *     polling + GitHub release discovery + token modal
 *   - The AppContent / AppWithTheme components
 *   - The legacy AuthProvider + ThemeProvider context wrappers
 *     (replaced by FluentProvider's `theme` prop in
 *     [./layout/AppShell.tsx](./layout/AppShell.tsx) + the
 *     `auth/token` module + TokenGate primitive)
 *   - The `?ui=legacy` URL switch + window.location.search check
 *
 * Why this file is now ~10 LoC: the redesigned UI is feature-
 * complete (Phases A through H6). The legacy tab UI was kept around
 * for one release cycle as a rollback escape hatch and is now gone.
 *
 * @see docs/PHASE_I1_STRIP_LEGACY_TOGGLE.md
 * @see docs/PHASE_I2_LEGACY_CLEANUP.md
 */
import React from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './router';

export const App: React.FC = () => {
  return <RouterProvider router={router} />;
};

