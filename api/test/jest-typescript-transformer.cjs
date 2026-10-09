const crypto = require('node:crypto');
const fs = require('node:fs');
const ts = require('typescript');

const TRANSFORMER_SOURCE = fs.readFileSync(__filename);
const HOISTED_JEST_METHODS = new Set([
  'disableAutomock',
  'enableAutomock',
  'mock',
  'unmock',
]);

function isHoistedJestCall(statement) {
  if (!ts.isExpressionStatement(statement)) {
    return false;
  }

  const expression = statement.expression;
  if (
    !ts.isCallExpression(expression) ||
    !ts.isPropertyAccessExpression(expression.expression)
  ) {
    return false;
  }

  const receiver = expression.expression.expression;
  const method = expression.expression.name;
  return (
    ts.isIdentifier(receiver) &&
    receiver.text === 'jest' &&
    HOISTED_JEST_METHODS.has(method.text)
  );
}

function hoistJestCalls() {
  return (sourceFile) => {
    const hoisted = sourceFile.statements.filter(isHoistedJestCall);
    if (hoisted.length === 0) {
      return sourceFile;
    }

    const remaining = sourceFile.statements.filter(
      (statement) => !isHoistedJestCall(statement),
    );
    return ts.factory.updateSourceFile(sourceFile, [...hoisted, ...remaining]);
  };
}

module.exports = {
  getCacheKey(sourceText, sourcePath, transformOptions) {
    return crypto
      .createHash('sha256')
      .update(TRANSFORMER_SOURCE)
      .update(ts.version)
      .update(sourcePath)
      .update(sourceText)
      .update(transformOptions?.configString ?? '')
      .update(String(transformOptions?.instrument ?? false))
      .digest('hex');
  },

  process(sourceText, sourcePath) {
    const result = ts.transpileModule(sourceText, {
      fileName: sourcePath,
      compilerOptions: {
        allowJs: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        inlineSourceMap: true,
        inlineSources: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      transformers: {
        before: [hoistJestCalls],
      },
    });

    return { code: result.outputText };
  },
};
