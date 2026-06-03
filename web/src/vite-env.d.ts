/// <reference types="vite/client" />

/**
 * Injected at build time by `vite.config.ts` via `define`.
 * Source of truth: `web/package.json#version`.
 * Rendered in the app header (see `src/layout/AppHeader.tsx`).
 */
declare const __APP_VERSION__: string;
