import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SOURCE_ROOT = path.resolve(__dirname, '..');
const INTERNAL_LABEL = /\b(?:WI-[A-Z0-9.-]+|W\d+(?:\.\d+)+(?:[A-Z0-9.-]*)?|Phase\s+[A-Z0-9.-]+|[PG]\d{1,2}[A-Za-z]?)(?=[:\s-])/i;

function productionSourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'generated') return [];
      return productionSourceFiles(entryPath);
    }
    if (!entry.name.endsWith('.ts') || /\.(?:spec|test)\.ts$/.test(entry.name)) return [];
    return [entryPath];
  });
}

function stringLiterals(filePath: string): string[] {
  const source = ts.createSourceFile(
    filePath,
    fs.readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) literals.push(node.text);
    ts.forEachChild(node, visit);
  }

  visit(source);
  return literals;
}

describe('user-facing API copy', () => {
  const sourceFiles = productionSourceFiles(SOURCE_ROOT);

  it('excludes generated source artifacts', () => {
    expect(sourceFiles.some((filePath) => filePath.includes(`${path.sep}generated${path.sep}`))).toBe(false);
  });

  it.each(sourceFiles)(
    'does not expose internal work-item or phase labels in %s',
    (filePath) => {
      const violations = stringLiterals(filePath).filter((value) => INTERNAL_LABEL.test(value));
      expect(violations).toEqual([]);
    },
  );
});
