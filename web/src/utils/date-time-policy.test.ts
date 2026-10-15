import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const partialFormatter = /\.toLocale(?:Date|Time)String\s*\(/;

function productionViews(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionViews(path);
    return entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx') ? [path] : [];
  });
}

describe('UI timestamp policy', () => {
  it.each(['new Date(value).toLocaleDateString()', 'date.toLocaleTimeString()'])(
    'detects a return to a partial timestamp formatter: %s',
    (source) => expect(partialFormatter.test(source)).toBe(true),
  );

  it('keeps date-only and time-only native formatters out of production views', () => {
    const violations = productionViews(
      resolve(dirname(fileURLToPath(import.meta.url)), '..'),
    ).filter((path) => partialFormatter.test(readFileSync(path, 'utf8')));
    expect(violations).toEqual([]);
  });
});
