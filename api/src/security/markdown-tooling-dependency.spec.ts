import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');

describe('repository Markdown tooling dependency', () => {
  it('requires the patched markdown-it 14.3.3 floor', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>;
    };
    expect(manifest.devDependencies['markdown-it']).toBe('^14.3.3');
  });

  it('locks the patched parser with public SHA-512 provenance and matching manifest floor', () => {
    const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')) as {
      packages: Record<string, {
        version?: string;
        resolved?: string;
        integrity?: string;
        devDependencies?: Record<string, string>;
      }>;
    };
    expect(lock.packages[''].devDependencies?.['markdown-it']).toBe('^14.3.3');
    expect(lock.packages['node_modules/markdown-it'].version).toBe('14.3.3');
    expect(lock.packages['node_modules/markdown-it'].resolved).toBe(
      'https://registry.npmjs.org/markdown-it/-/markdown-it-14.3.3.tgz',
    );
    expect(lock.packages['node_modules/markdown-it'].integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
  });
});
