import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8');

describe('Vitest worker policy', () => {
  it('uses threads on Windows and forks on other platforms', () => {
    expect(config).toMatch(/^\s+pool: process\.platform === 'win32' \? 'threads' : 'forks',$/m);
  });

  it('keeps test-file isolation enabled', () => {
    expect(config).toMatch(/^\s+isolate: true,$/m);
  });
});
