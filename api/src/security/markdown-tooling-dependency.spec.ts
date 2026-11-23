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
});
