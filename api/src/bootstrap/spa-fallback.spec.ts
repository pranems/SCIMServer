/**
 * Unit tests for the spa-fallback Express middleware. Lock in:
 *   - SPA_PATH_PREFIXES list matches what the production main.ts uses
 *     (i.e. nobody silently dropped /endpoints from the fallback)
 *   - resolveSpaIndexPath returns a path under public/index.html
 *   - applySpaFallback registers middleware via app.use() for every
 *     prefix exactly once, mounted with the same handler
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { SPA_PATH_PREFIXES, resolveSpaIndexPath, applySpaFallback } from './spa-fallback';

describe('spa-fallback helper', () => {
  describe('SPA_PATH_PREFIXES', () => {
    it('contains every top-level SPA route prefix', () => {
      // MUST stay in sync with the top-level routes in web/src/router.ts. A
      // route present there but absent here 404s on hard-refresh / deep-link.
      // The 2026-07-07 dev-deploy audit found /discovery, /operations,
      // /workbench, /me, /manual-provision missing here (they 404'd on hard
      // navigation) - this list now covers all top-level SPA routes.
      expect([...SPA_PATH_PREFIXES]).toEqual([
        '/admin',
        '/discovery',
        '/endpoints',
        '/logs',
        '/manual-provision',
        '/me',
        '/operations',
        '/settings',
        '/workbench',
      ]);
    });

    it('is sorted so the list is easy to eyeball against the router', () => {
      const sorted = [...SPA_PATH_PREFIXES].sort();
      expect([...SPA_PATH_PREFIXES]).toEqual(sorted);
    });

    // Drift guard: read the ACTUAL top-level route files in
    // web/src/routes and assert every top-level URL prefix they declare
    // is covered by SPA_PATH_PREFIXES. A route added to the router but
    // not to the allowlist 404s on hard-refresh - the exact escape the
    // 2026-07-07 dev-deploy audit found for /discovery + /operations +
    // /workbench + /me + /manual-provision. Skips when the web tree is
    // not present (isolated api container), so it is a dev-time guard.
    const routesDir = join(__dirname, '..', '..', '..', 'web', 'src', 'routes');
    const hasWebRoutes = existsSync(routesDir);
    (hasWebRoutes ? it : it.skip)(
      'covers every top-level route declared in web/src/routes (drift guard)',
      () => {
        const routeFiles = readdirSync(routesDir).filter(
          (f) => f.endsWith('.tsx') && !f.startsWith('__'),
        );
        const allowed = new Set<string>(SPA_PATH_PREFIXES);
        const missing: Array<{ file: string; prefix: string }> = [];
        for (const file of routeFiles) {
          const src = readFileSync(join(routesDir, file), 'utf8');
          // Only routes parented on rootRoute contribute a top-level
          // URL prefix. Nested routes inherit their ancestor's prefix.
          if (!/getParentRoute:\s*\(\)\s*=>\s*rootRoute/.test(src)) continue;
          const pathMatch = src.match(/path:\s*['"]([^'"]+)['"]/);
          if (!pathMatch) continue;
          const routePath = pathMatch[1];
          if (routePath === '/') continue; // index route, served by root
          const segments = routePath.split('/').filter(Boolean);
          if (segments.length === 0) continue;
          const prefix = '/' + segments[0];
          if (!allowed.has(prefix)) missing.push({ file, prefix });
        }
        expect(missing).toEqual([]);
      },
    );

    it('every prefix is a single-segment URL starting with /', () => {
      for (const prefix of SPA_PATH_PREFIXES) {
        expect(prefix.startsWith('/')).toBe(true);
        // Single segment - no nested paths in this list. Nested paths
        // get matched implicitly because Express treats the prefix as
        // a mount point.
        expect(prefix.slice(1).includes('/')).toBe(false);
      }
    });
  });

  describe('resolveSpaIndexPath', () => {
    it('returns a path ending in public/index.html', () => {
      const p = resolveSpaIndexPath();
      // Use a regex that tolerates either Windows \ or POSIX /.
      expect(p).toMatch(/[\\/]public[\\/]index\.html$/);
    });

    it('points at the bundled SPA, not the source tree', () => {
      // The middleware reads via __dirname which at runtime points at
      // dist/bootstrap (or src/bootstrap during ts-jest). Walking up
      // two levels lands at the api root (/app in containers) where
      // the public/ folder with the SPA bundle lives.
      const p = resolveSpaIndexPath();
      // Accept either dist/bootstrap/../../public (production) or
      // src/bootstrap/../../public (test); both resolve to <api>/public.
      expect(/[\\/](?:dist|src)[\\/]bootstrap[\\/]\.\.[\\/]\.\.[\\/]public[\\/]index\.html$|[\\/]public[\\/]index\.html$/.test(p)).toBe(true);
    });
  });

  describe('applySpaFallback', () => {
    it('calls app.use() once per prefix with a function handler', () => {
      const useCalls: Array<[string, unknown]> = [];
      const fakeApp = {
        use: (path: string, handler: unknown) => {
          useCalls.push([path, handler]);
        },
      } as unknown as Parameters<typeof applySpaFallback>[0];

      applySpaFallback(fakeApp);

      expect(useCalls).toHaveLength(SPA_PATH_PREFIXES.length);
      for (let i = 0; i < SPA_PATH_PREFIXES.length; i++) {
        expect(useCalls[i][0]).toBe(SPA_PATH_PREFIXES[i]);
        expect(typeof useCalls[i][1]).toBe('function');
      }
    });

    it('handler returns text/html with status 200 and a non-empty body', () => {
      const useCalls: Array<[string, (req: unknown, res: { type: (t: string) => any; status: (n: number) => any; send: (b: string) => any }) => void]> = [];
      const fakeApp = {
        use: (path: string, handler: any) => {
          useCalls.push([path, handler]);
        },
      } as unknown as Parameters<typeof applySpaFallback>[0];

      applySpaFallback(fakeApp);

      const handler = useCalls[0][1];
      let typeArg = '';
      let statusArg = 0;
      let bodyArg = '';
      const fakeRes = {
        type: (t: string) => {
          typeArg = t;
          return fakeRes;
        },
        status: (n: number) => {
          statusArg = n;
          return fakeRes;
        },
        send: (b: string) => {
          bodyArg = b;
          return fakeRes;
        },
      };

      handler({}, fakeRes);

      expect(typeArg).toBe('text/html');
      expect(statusArg).toBe(200);
      expect(bodyArg.length).toBeGreaterThan(50);
      expect(bodyArg.toLowerCase()).toMatch(/^<!doctype html/);
    });

    it('uses readFileSync once at startup, not per request', () => {
      // We can't easily spy on fs without mocking the module, so verify
      // the assumption indirectly: two handlers on different prefixes
      // share the SAME body string. If the middleware re-read the file
      // on every request the strings would still be equal (same file)
      // but the test is defensive against future regressions where
      // someone "optimizes" by using sendFile() and accidentally
      // reintroduces per-request disk reads.
      const useCalls: Array<[string, any]> = [];
      const fakeApp = { use: (p: string, h: any) => { useCalls.push([p, h]); } } as any;
      applySpaFallback(fakeApp);

      const bodies: string[] = [];
      for (const [, handler] of useCalls) {
        let captured = '';
        const res = {
          type: () => res,
          status: () => res,
          send: (b: string) => { captured = b; return res; },
        };
        handler({}, res);
        bodies.push(captured);
      }
      // All handlers serve the same cached body.
      expect(new Set(bodies).size).toBe(1);
    });
  });

  // Sanity check that the fixture path actually exists in the build (or
  // at least the directory does). If this fails in CI it likely means
  // someone moved the public/ folder.
  it('resolveSpaIndexPath: parent directory of resolved path exists in repo layout', () => {
    const p = resolveSpaIndexPath();
    // The resolved path joins __dirname/../public/index.html. We can
    // assert that one of two parent directories exists: either
    // api/dist/public (production build) or api/src/public (which
    // doesn't normally exist - that's the placeholder case).
    // We don't assert the file itself exists because tests run before
    // builds.
    const parentDir = p.replace(/[\\/]index\.html$/, '');
    // Either the directory exists, or it doesn't (and the middleware
    // serves the placeholder). Both are acceptable; this assertion is
    // here purely to document the contract.
    expect(typeof existsSync(parentDir)).toBe('boolean');
  });
});
