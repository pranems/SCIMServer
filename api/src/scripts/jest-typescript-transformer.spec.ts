import path from 'node:path';
import vm from 'node:vm';

type JestTransformer = {
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
});
