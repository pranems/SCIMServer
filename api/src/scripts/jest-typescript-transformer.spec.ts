import path from 'node:path';
import vm from 'node:vm';

type JestTransformer = {
  getCacheKey(
    sourceText: string,
    sourcePath: string,
    transformOptions?: { configString?: string; instrument?: boolean },
  ): string;
  process(sourceText: string, sourcePath: string): { code: string };
};

function loadTransformer(): JestTransformer {
  const transformerPath = path.resolve(
    __dirname,
    '../../test/jest-typescript-transformer.cjs',
  );
  return require(transformerPath) as JestTransformer;
}

function evaluateCommonJs(code: string): Record<string, unknown> {
  const module = { exports: {} as Record<string, unknown> };
  vm.runInNewContext(code, {
    __dirname,
    __filename,
    exports: module.exports,
    module,
    require,
  });
  return module.exports;
}

describe('Jest TypeScript transformer', () => {
  it.each([
    ['TypeScript', 'export const answer: number = 42;', 'answer', 42],
    ['ES module JavaScript', 'export const answer = 43;', 'answer', 43],
  ])('transforms %s into executable CommonJS', (_, source, key, expected) => {
    const transformer = loadTransformer();
    const result = transformer.process(source, `fixture-${expected}.ts`);

    expect(evaluateCommonJs(result.code)[key]).toBe(expected);
  });

  it('hoists Jest mocks before transformed dependency imports', () => {
    const transformer = loadTransformer();
    const result = transformer.process(
      "const dependency = require('./dependency'); jest.mock('./dependency'); export { dependency };",
      'fixture-hoist.ts',
    );

    expect(result.code.indexOf("mock('./dependency')")).toBeLessThan(
      result.code.indexOf("require('./dependency')"),
    );
  });

  it('invalidates cached output when the transformed source changes', () => {
    const transformer = loadTransformer();
    const first = transformer.getCacheKey('export const value = 1;', 'a.ts');
    const repeated = transformer.getCacheKey(
      'export const value = 1;',
      'a.ts',
    );
    const changed = transformer.getCacheKey('export const value = 2;', 'a.ts');

    expect(repeated).toBe(first);
    expect(changed).not.toBe(first);
  });
});
