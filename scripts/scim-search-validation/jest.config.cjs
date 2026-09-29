const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const API = path.resolve(__dirname, '..', '..', 'api');
const ts = require(path.join(API, 'node_modules', 'typescript'));
const file = path.join(API, 'test', 'e2e', 'jest-e2e.config.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(compiled, file);
const { globalSetup, globalTeardown, ...original } = loaded.exports.default;
module.exports = {
  ...original,
  rootDir: API,
  moduleNameMapper: {
    ...original.moduleNameMapper,
    '^\\./helpers/app\\.helper$': '<rootDir>/test/e2e/helpers/owned-search-app.helper.ts',
  },
  globalSetup: path.join(__dirname, 'setup.cjs'),
  reporters: ['default'],
};
