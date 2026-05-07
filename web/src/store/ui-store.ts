/**
 * Zustand store for client-only UI state.
 *
 * Only 3 values - everything else is server state managed by TanStack
 * Query. Routing is now owned by TanStack Router (see web/src/router.ts);
 * the previous `currentPath`, `navigate`, and popstate listener have been
 * removed in Phase A2 cutover.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D4
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 */
import { create } from 'zustand';

interface UIState {
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Whether the command palette is open */
  commandPaletteOpen: boolean;
  /** Current color scheme */
  colorScheme: 'light' | 'dark' | 'system';

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  colorScheme: (localStorage.getItem('scim-color-scheme') as 'light' | 'dark' | 'system') ?? 'system',

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setColorScheme: (scheme) => {
    localStorage.setItem('scim-color-scheme', scheme);
    set({ colorScheme: scheme });
  },
}));
