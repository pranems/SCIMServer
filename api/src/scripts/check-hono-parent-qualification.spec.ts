import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { satisfiesGhsaRange } from './check-dependency-pins';

type Package = {
  name?: string;
  version: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
};
const apiRoot = resolve(__dirname, '../..');
const readPackage = (path: string): Package => JSON.parse(readFileSync(path, 'utf8')) as Package;
const installedPackage = (name: string, owner = apiRoot): Package =>
  readPackage(resolve(dirname(require.resolve(name, { paths: [owner] })), '..', 'package.json'));
const lock = JSON.parse(readFileSync(resolve(apiRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, Package>;
};
const manifest = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8')) as {
  overrides: Record<string, string>;
};
const range = '>= 1.19.10, < 2.1.3';

describe('Hono adapter qualification for its actual Prisma parent', () => {
  it('distinguishes the affected baseline from the first fixed release', () => {
    expect(satisfiesGhsaRange('1.19.15', range)).toBe(true);
    expect(satisfiesGhsaRange('2.1.3', range)).toBe(false);
  });

  it('pins every locked occurrence to the qualified public package', () => {
    expect(manifest.overrides['@hono/node-server']).toBe('2.1.3');
    const occurrences = Object.entries(lock.packages).filter(([path]) =>
      path.endsWith('node_modules/@hono/node-server'),
    );
    expect(occurrences.map(([path]) => path)).toEqual(['node_modules/@hono/node-server']);
    for (const [, entry] of occurrences) {
      expect(entry.version).toBe('2.1.3');
      expect(satisfiesGhsaRange(entry.version, range)).toBe(false);
      expect(entry.resolved).toBe('https://registry.npmjs.org/@hono/node-server/-/node-server-2.1.3.tgz');
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
  });

  it('keeps the actual Prisma owner and its upstream adapter constraint explicit', () => {
    const prismaPath = dirname(require.resolve('prisma/package.json'));
    const prisma = readPackage(resolve(prismaPath, 'package.json'));
    const devEntry = require.resolve('@prisma/dev', { paths: [prismaPath] });
    const dev = installedPackage('@prisma/dev', prismaPath);
    expect(prisma.version).toBe('7.8.0');
    expect(prisma.dependencies?.['@prisma/dev']).toBe('0.24.3');
    expect(dev.name).toBe('@prisma/dev');
    expect(dev.version).toBe('0.24.3');
    expect(dev.dependencies?.['@hono/node-server']).toBe('1.19.11');
    expect(installedPackage('@hono/node-server', dirname(devEntry)).version).toBe('2.1.3');
    expect(lock.packages['node_modules/prisma'].version).toBe(prisma.version);
    expect(lock.packages['node_modules/@prisma/dev'].version).toBe(dev.version);
  });

  it('retains the parent-facing adapter exports without opening a listener', () => {
    const adapter = require('@hono/node-server') as {
      serve: unknown;
      getRequestListener: unknown;
      createAdaptorServer: (options: { fetch: () => Response; overrideGlobalObjects: boolean }) => {
        listening: boolean;
      };
    };
    const request = globalThis.Request;
    const response = globalThis.Response;
    expect(typeof adapter.serve).toBe('function');
    expect(typeof adapter.getRequestListener).toBe('function');
    const server = adapter.createAdaptorServer({
      fetch: () => new Response('synthetic'),
      overrideGlobalObjects: false,
    });
    expect(server.listening).toBe(false);
    expect(globalThis.Request).toBe(request);
    expect(globalThis.Response).toBe(response);
  });

  it('rejects the real double-decode exploit while retaining normal routing', async () => {
    const { Hono } = require('hono') as typeof import('hono');
    const { serveStatic } = require('@hono/node-server/serve-static') as
      typeof import('@hono/node-server/serve-static');
    const root = resolve(apiRoot, '../test-results', `hono-static-regression-${process.pid}`);
    mkdirSync(resolve(root, 'static/admin'), { recursive: true });
    writeFileSync(resolve(root, 'static/admin/secret.txt'), 'synthetic-protected');
    writeFileSync(resolve(root, 'static/public.txt'), 'synthetic-public');
    try {
      const app = new Hono();
      app.use('/static/admin/*', c => c.text('Unauthorized', 401));
      app.use('/static/*', serveStatic({ root }));
      const publicFile = await app.request('/static/public.txt');
      expect(publicFile.status).toBe(200);
      expect(await publicFile.text()).toBe('synthetic-public');
      for (const path of ['/static/admin/secret.txt', '/static/%61dmin/secret.txt']) {
        const protectedFile = await app.request(path);
        expect(protectedFile.status).toBe(401);
        expect(await protectedFile.text()).toBe('Unauthorized');
      }
      const exploit = await app.request('/static/%%36%31dmin/secret.txt');
      expect(exploit.status).toBe(404);
      expect(await exploit.text()).not.toBe('synthetic-protected');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('requires the complete installed npm inventory to be valid', () => {
    const npm = process.env.npm_execpath;
    expect(npm).toBeDefined();
    const inventory = spawnSync(process.execPath, [npm!, 'ls', '--all', '--json'], {
      cwd: apiRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    });
    expect(inventory.error).toBeUndefined();
    expect({ status: inventory.status, error: inventory.stderr.slice(0, 1000) })
      .toEqual({ status: 0, error: '' });
    const tree = JSON.parse(inventory.stdout) as { problems?: string[] };
    expect(tree.problems ?? []).toEqual([]);
  });
});
