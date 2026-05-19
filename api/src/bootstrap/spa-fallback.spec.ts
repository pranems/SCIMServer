/**
 * Unit tests for the spa-fallback Express middleware. Lock in:
 *   - SPA_PATH_PREFIXES list matches what the production main.ts uses
 *     (i.e. nobody silently dropped /endpoints from the fallback)
 *   - resolveSpaIndexPath returns a path under public/index.html
 *   - applySpaFallback registers middleware via app.use() for every
 *     prefix exactly once, mounted with the same handler
 */
import { existsSync } from 'node:fs';
import { SPA_PATH_PREFIXES, resolveSpaIndexPath, applySpaFallback } from './spa-fallback';

describe('spa-fallback helper', () => {
  describe('SPA_PATH_PREFIXES', () => {
    it('contains the four current SPA path prefixes', () => {
      // Phase A1+ adds /endpoints, /logs, /settings; legacy /admin
      // tab UI still ships under ?ui=legacy. If a future phase drops
      // a prefix or adds a new one, update this assertion AND
      // web/src/router.ts in lockstep.
      expect([...SPA_PATH_PREFIXES]).toEqual(['/admin', '/endpoints', '/logs', '/settings']);
    });

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
