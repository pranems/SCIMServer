/**
 * spa-fallback.ts - shared Express middleware that serves the SPA
 * index.html for every URL the TanStack Router owns.
 *
 * Why: Phase A4 introduced URL-driven routes (/endpoints, /logs,
 * /settings, plus all `:endpointId` children). When the user does a
 * hard refresh or follows a deep link, the request hits the Express
 * server, which has no NestJS controller for those paths and would
 * otherwise return a 404 JSON. Phase A5's Playwright smoke tests
 * surfaced this gap.
 *
 * The legacy `/admin` SPA path was already covered by an inline
 * `app.use('/admin', ...)` in main.ts. This module generalises that
 * pattern so the fix lives in one place and is shared by main.ts and
 * the E2E test harness.
 *
 * IMPORTANT: keep this list in sync with the route tree in
 * web/src/router.ts. Adding a top-level SPA route there without
 * adding it here means deep links break in production.
 */
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Top-level URL prefixes owned by the SPA. */
export const SPA_PATH_PREFIXES = [
  '/admin',     // legacy admin tab UI
  '/endpoints', // Phase A1+ - endpoints list and per-endpoint detail (incl. tabs)
  '/logs',      // Phase A1+ - global logs page
  '/settings',  // Phase A1+ - global settings page
] as const;

/** Where the bundled SPA index.html lives relative to the api root.
 *
 * Container layout (production Dockerfile):
 *   /app/dist/main.js            <- entry point
 *   /app/dist/bootstrap/spa-fallback.js  <- this file at runtime
 *   /app/public/index.html       <- SPA bundle (from web/dist)
 *
 * So we walk up TWO levels from this file's runtime location to reach
 * /app/, then join `public/index.html`. The previous single-`..` was
 * inherited from main.ts which sits at /app/dist/main.js (one level
 * up = /app/) - but this helper file is one level deeper.
 */
export function resolveSpaIndexPath(): string {
  return join(__dirname, '..', '..', 'public', 'index.html');
}

/**
 * Minimal HTML returned when the SPA bundle is not present on disk
 * (e.g. unit / E2E tests that haven't run `vite build` first). Production
 * always has the bundle. Returning a non-empty text/html body is what
 * the spa-fallback E2E test asserts on - it doesn't try to load the JS,
 * it just checks the server didn't 404 the SPA route.
 */
const PLACEHOLDER_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>SCIMServer</title></head>' +
  '<body><p>SPA bundle not built (placeholder served by spa-fallback middleware).</p></body></html>';

/**
 * Mount Express middleware so any GET under one of the SPA path
 * prefixes returns index.html. Mount BEFORE NestJS guards / global
 * prefix so the fallback wins over a would-be 404. Mount AFTER
 * useStaticAssets so static files (CSS / JS / images) under those
 * prefixes (none today, but future-proof) still resolve normally.
 *
 * If the bundled index.html is missing (test environments without
 * `vite build`), serves a tiny placeholder HTML and logs a warning at
 * startup so the absence is observable. The middleware MUST always
 * respond with text/html so deep-link refresh still produces a UI
 * shell instead of a NestJS JSON 404.
 */
export function applySpaFallback(app: NestExpressApplication): void {
  const indexHtmlPath = resolveSpaIndexPath();
  const haveIndex = existsSync(indexHtmlPath);
  // Cache the file contents so we read from disk once, not per request.
  const indexBody = haveIndex ? readFileSync(indexHtmlPath, 'utf-8') : PLACEHOLDER_HTML;
  if (!haveIndex) {
    new Logger('SpaFallback').warn(
      `SPA bundle not found at ${indexHtmlPath} - serving placeholder HTML for SPA routes. ` +
      'Run `npm --workspace web run build && npm run sync:spa` to populate it.',
    );
  }
  for (const prefix of SPA_PATH_PREFIXES) {
    app.use(prefix, (_req: Request, res: Response) => {
      // Set explicit content-type because we send a string body, not
      // sendFile (which would set the header from the file extension).
      res.type('text/html').status(200).send(indexBody);
    });
  }
}
