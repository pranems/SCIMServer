import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Manifest = {
  version?: string;
  overrides?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
type LockEntry = Manifest & { resolved?: string; integrity?: string };

const apiRoot = resolve(__dirname, '../..');
const manifest = JSON.parse(readFileSync(resolve(apiRoot, 'package.json'), 'utf8')) as Manifest;
const lock = JSON.parse(readFileSync(resolve(apiRoot, 'package-lock.json'), 'utf8')) as {
  packages: Record<string, LockEntry>;
};
const semver = require('semver') as { satisfies(version: string, range: string): boolean };
const dependencyKinds = ['dependencies', 'optionalDependencies', 'peerDependencies'] as const;
const sharedPackages = [
  {
    name: 'debug',
    version: '4.4.3',
    owners: [
      ['@babel/core', '^4.1.0'],
      ['@babel/traverse', '^4.3.1'],
      ['@eslint/config-array', '^4.3.1'],
      ['@tokenizer/inflate', '^4.4.3'],
      ['@typescript-eslint/parser', '^4.4.3'],
      ['@typescript-eslint/project-service', '^4.4.3'],
      ['@typescript-eslint/type-utils', '^4.4.3'],
      ['@typescript-eslint/typescript-estree', '^4.4.3'],
      ['body-parser', '^4.4.3'],
      ['eslint', '^4.3.2'],
      ['express', '^4.4.0'],
      ['finalhandler', '^4.4.0'],
      ['istanbul-lib-source-maps', '^4.1.1'],
      ['router', '^4.4.0'],
      ['send', '^4.4.3'],
      ['superagent', '^4.3.7'],
    ],
  },
  {
    name: 'get-intrinsic',
    version: '1.3.0',
    owners: [
      ['call-bound', '^1.3.0'],
      ['es-set-tostringtag', '^1.2.6'],
      ['side-channel-map', '^1.2.5'],
      ['side-channel-weakmap', '^1.2.5'],
    ],
  },
  {
    name: 'hasown',
    version: '2.0.4',
    owners: [
      ['es-set-tostringtag', '^2.0.2'],
      ['form-data', '^2.0.4'],
      ['get-intrinsic', '^2.0.2'],
    ],
  },
  {
    name: 'call-bind-apply-helpers',
    version: '1.0.2',
    owners: [
      ['call-bound', '^1.0.2'],
      ['dunder-proto', '^1.0.1'],
      ['get-intrinsic', '^1.0.2'],
    ],
  },
];

describe('API shared override context validity', () => {
  it.each(sharedPackages)('gives $name one exact root override, not competing ancestry', ({ name, version }) => {
    const selectors: string[] = [];
    const collect = (overrides: Record<string, unknown>, parents: string[] = []): void => {
      for (const [selector, value] of Object.entries(overrides)) {
        const path = [...parents, selector];
        if (selector === name || selector.startsWith(`${name}@`)) selectors.push(path.join(' > '));
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          collect(value as Record<string, unknown>, path);
        }
      }
    };
    collect(manifest.overrides ?? {});
    expect(selectors).toEqual([name]);
    expect(manifest.overrides?.[name]).toBe(version);
  });

  it.each(sharedPackages)('keeps every $name occurrence and real owner compatible with public provenance', ({ name, version, owners }) => {
    const occurrences = Object.entries(lock.packages).filter(([path]) =>
      path === `node_modules/${name}` || path.endsWith(`/node_modules/${name}`),
    );
    expect(occurrences.map(([path]) => path)).toEqual([`node_modules/${name}`]);
    for (const [, entry] of occurrences) {
      expect(entry.version).toBe(version);
      expect(entry.resolved).toBe(`https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`);
      expect(entry.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
    }
    const actualOwners = Object.entries(lock.packages).flatMap(([path, entry]) =>
      dependencyKinds.flatMap(kind => {
        const range = entry[kind]?.[name];
        return range ? [{ path, kind, range }] : [];
      }),
    );
    expect(actualOwners.map(({ path, range }) => [path, range])).toEqual(
      owners.map(([owner, range]) => [`node_modules/${owner}`, range]),
    );
    for (const { path, kind, range } of actualOwners) {
      const ownerPath = resolve(apiRoot, path, 'package.json');
      const owner = JSON.parse(readFileSync(ownerPath, 'utf8')) as Manifest;
      expect(owner[kind]?.[name]).toBe(range);
      expect(semver.satisfies(version, range)).toBe(true);
      const installedPath = require.resolve(`${name}/package.json`, { paths: [dirname(ownerPath)] });
      expect(installedPath).toBe(resolve(apiRoot, `node_modules/${name}/package.json`));
      const installed = JSON.parse(readFileSync(installedPath, 'utf8')) as Manifest;
      expect(installed.version).toBe(version);
    }
  });

  it('accepts the real complete installed npm tree without invalid records', () => {
    const npmCli = process.env.npm_execpath;
    expect(npmCli).toBeDefined();
    // A targeted inventory can omit unrelated invalid edges. Exit status and
    // problems from the full command are both part of this regression contract.
    const output = execFileSync(process.execPath, [npmCli!, 'ls', '--all', '--json'], {
      cwd: apiRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    const inventory = JSON.parse(output) as { problems?: string[] };
    expect(inventory.problems ?? []).toEqual([]);
  }, 65_000);
});
