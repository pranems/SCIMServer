/**
 * Zustand store for client-only UI state.
 *
 * Only a few values - everything else is server state managed by TanStack
 * Query. Routing is owned by TanStack Router (see web/src/router.ts);
 * the previous `currentPath`, `navigate`, and popstate listener were
 * removed in Phase A2 cutover.
 *
 * Phase K2 added `sseConnectionState` so the <HealthRollup /> header
 * widget can surface the realtime channel's actual lifecycle state
 * without bolting another React context onto AppShell. useSSE writes
 * to it on connect / open / error / unmount; useHealthRollup reads it.
 *
 * @see docs/UI_REDESIGN_ARCHITECTURE_AND_PLAN.md D4
 * @see docs/UI_REDESIGN_REMAINING_GAPS_PLAN.md Phase A2
 * @see docs/PHASE_K2_SERVICE_HEALTH_ROLLUP.md
 */
import { create } from 'zustand';

/** Lifecycle states the SSE EventSource transitions through. */
export type SseConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

interface UIState {
  /** Whether the sidebar is collapsed */
  sidebarCollapsed: boolean;
  /** Whether the command palette is open */
  commandPaletteOpen: boolean;
  /** Current color scheme */
  colorScheme: 'light' | 'dark' | 'system';
  /**
   * Phase K2 - current SSE EventSource lifecycle state. Updated by
   * useSSE; read by useHealthRollup. Default 'closed' so the rollup
   * surfaces a "down" Realtime substatus until the EventSource
   * actually opens.
   */
  sseConnectionState: SseConnectionState;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
  setSseConnectionState: (state: SseConnectionState) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  colorScheme: (localStorage.getItem('scim-color-scheme') as 'light' | 'dark' | 'system') ?? 'system',
  sseConnectionState: 'closed',

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setColorScheme: (scheme) => {
    localStorage.setItem('scim-color-scheme', scheme);
    set({ colorScheme: scheme });
  },
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
}));
