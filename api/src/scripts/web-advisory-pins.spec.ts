import fs from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

type PackageEntry = {
  version?: string;
  resolved?: string;
  integrity?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

describe('web Seroval and Undici remediation (#256)', () => {
  const web = resolve(__dirname, '../../../web');
  const patches = [
    { name: 'seroval', version: '1.6.11', owners: [
      ['node_modules/@tanstack/router-core', 'dependencies', '^1.5.4'],
      ['node_modules/seroval-plugins', 'peerDependencies', '^1.0'],
    ] },
    { name: 'undici', version: '7.30.1', owners: [
      ['node_modules/jsdom', 'dependencies', '^7.25.0'],
    ] },
  ];

  it.each(patches)('pins $name to its minimal exact patch', async ({ name, version }) => {
    const manifest = JSON.parse(await fs.readFile(resolve(web, 'package.json'), 'utf8')) as {
      overrides: Record<string, string>;
    };
    expect(manifest.overrides[name]).toBe(version);
  });

  it.each(patches)('checks every locked and installed $name occurrence', async ({ name, version }) => {
    const lock = JSON.parse(await fs.readFile(resolve(web, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, PackageEntry>;
    };
    const entries = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    expect(entries.length).toBeGreaterThan(0);
    for (const [path, entry] of entries) {
      expect(entry.version).toBe(version);
      expect(entry.resolved).toBe(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
      const installed = JSON.parse(
        await fs.readFile(resolve(web, path, 'package.json'), 'utf8'),
      ) as { version: string };
      expect(installed.version).toBe(version);
    }
  });

  it.each(patches)('resolves $name from every actual owner context', async ({ name, version, owners }) => {
    const lock = JSON.parse(await fs.readFile(resolve(web, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, PackageEntry>;
    };
    const actualOwners = Object.entries(lock.packages).flatMap(([path, entry]) =>
      (['dependencies', 'optionalDependencies', 'peerDependencies'] as const).flatMap(kind => {
        const range = entry[kind]?.[name];
        return range ? [[path, kind, range]] : [];
      }),
    );
    expect(actualOwners).toEqual(owners);
    for (const [owner, kind, range] of actualOwners) {
      const ownerPath = resolve(web, owner, 'package.json');
      const installedOwner = JSON.parse(await fs.readFile(ownerPath, 'utf8')) as PackageEntry;
      expect(installedOwner[kind as 'dependencies' | 'optionalDependencies' | 'peerDependencies']?.[name]).toBe(range);
      const installedPath = require.resolve(`${name}/package.json`, { paths: [dirname(ownerPath)] });
      const installed = JSON.parse(await fs.readFile(installedPath, 'utf8')) as { version: string };
      expect(installed.version).toBe(version);
    }
  });
});
