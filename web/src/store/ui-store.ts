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
import { usePreferencesStore } from './preferences-store';

/** Lifecycle states the SSE EventSource transitions through. */
export type SseConnectionState =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

/**
 * Phase K4 - log stream level keywords. Mirrors the server's
 * `LogLevel` enum vocabulary but as a string union so it serializes
 * cleanly into URLs / localStorage.
 */
export type LogStreamLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

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
  /**
   * Phase K4 - whether the live SSE log stream drawer is open. Toggled
   * from AppHeader; read by LogStreamDrawer. Default closed so the
   * drawer's EventSource is never opened until the operator asks for
   * it (the drawer's hook is gated on this flag).
   */
  logStreamDrawerOpen: boolean;
  /** Phase K4 - minimum log level filter applied to the buffered entries. */
  logStreamLevel: LogStreamLevel;
  /** Phase K4 - free-text search filter applied across message/path/category/requestId. */
  logStreamSearch: string;

  /**
   * Phase N1 - notifications drawer (right-side, separate from log
   * stream). Toggled from the AppHeader Bell button; read by
   * NotificationsDrawer. Default closed so the drawer's content is
   * not rendered until the operator opens it.
   */
  notificationsDrawerOpen: boolean;

  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleCommandPalette: () => void;
  setColorScheme: (scheme: 'light' | 'dark' | 'system') => void;
  setSseConnectionState: (state: SseConnectionState) => void;
  setLogStreamDrawerOpen: (open: boolean) => void;
  toggleLogStreamDrawer: () => void;
  setLogStreamLevel: (level: LogStreamLevel) => void;
  setLogStreamSearch: (search: string) => void;

  // Phase N1
  setNotificationsDrawerOpen: (open: boolean) => void;
  toggleNotificationsDrawer: () => void;

  /**
   * Phase N7 - apply persisted preferences-store defaults to chrome state.
   * Currently wires `sidebarCollapsedDefault` -> `sidebarCollapsed`. Called
   * ONCE at boot from main.tsx after preferences-store hydrates from
   * localStorage. Idempotent (safe to call multiple times).
   */
  applyPreferenceDefaults: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  commandPaletteOpen: false,
  colorScheme: (localStorage.getItem('scim-color-scheme') as 'light' | 'dark' | 'system') ?? 'system',
  sseConnectionState: 'closed',
  logStreamDrawerOpen: false,
  logStreamLevel: 'DEBUG',
  logStreamSearch: '',

  // Phase N1 - notifications drawer slice
  notificationsDrawerOpen: false,

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  toggleCommandPalette: () => set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
  setColorScheme: (scheme) => {
    localStorage.setItem('scim-color-scheme', scheme);
    set({ colorScheme: scheme });
  },
  setSseConnectionState: (state) => set({ sseConnectionState: state }),
  setLogStreamDrawerOpen: (open) => set({ logStreamDrawerOpen: open }),
  toggleLogStreamDrawer: () => set((s) => ({ logStreamDrawerOpen: !s.logStreamDrawerOpen })),
  setLogStreamLevel: (level) => set({ logStreamLevel: level }),
  setLogStreamSearch: (search) => set({ logStreamSearch: search }),

  // Phase N1
  setNotificationsDrawerOpen: (open) => set({ notificationsDrawerOpen: open }),
  toggleNotificationsDrawer: () => set((s) => ({ notificationsDrawerOpen: !s.notificationsDrawerOpen })),

  // Phase N7 - read sidebarCollapsedDefault from preferences-store and apply it to sidebarCollapsed.
  applyPreferenceDefaults: () => {
    const sidebarCollapsedDefault = usePreferencesStore.getState().sidebarCollapsedDefault;
    set({ sidebarCollapsed: sidebarCollapsedDefault });
  },
}));
