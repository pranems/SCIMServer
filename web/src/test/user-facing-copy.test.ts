/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INTERNAL_LABEL = /\b(?:WI-[A-Z0-9.-]+|W\d+(?:\.\d+)+(?:[A-Z0-9.-]*)?|Phase\s+[A-Z0-9.-]+|[PG]\d{1,2}[A-Za-z]?)(?=[:\s-])/i;

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: fs.Dirent) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return productionSourceFiles(entryPath);
    if (!/\.(?:ts|tsx)$/.test(entry.name) || /\.(?:test|spec)\.(?:ts|tsx)$/.test(entry.name)) return [];
    return [entryPath];
  });
}

function displayedStringLiterals(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) || ts.isJsxText(node)) {
      literals.push(node.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return literals;
}

describe('user-facing copy', () => {
  it.each(productionSourceFiles(SOURCE_ROOT))(
    'does not expose internal work-item or phase labels in %s',
    (filePath) => {
      const violations = displayedStringLiterals(filePath).filter((value) => INTERNAL_LABEL.test(value));
      expect(violations).toEqual([]);
    },
  );
});
