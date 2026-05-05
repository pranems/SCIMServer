/**
 * Zustand store for client-only UI state.
 *
 * Only 3 values - everything else is server state managed by TanStack Query.
 * D4: Zustand chosen for 1KB size, zero boilerplate.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D4
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
