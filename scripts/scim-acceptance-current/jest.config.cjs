const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { API, ROOT, sourceGuard } = require("./current-safety.cjs");

sourceGuard();
const ts = require(path.join(API, "node_modules", "typescript"));
const file = path.join(API, "test", "e2e", "jest-e2e.config.ts");
const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(compiled, file);
const { globalTeardown, ...original } = loaded.exports.default;
const corpus = path.join(
  ROOT,
  "docs",
  "evidence",
  "scim-fresh-20260925",
  "repro-postgres",
);

module.exports = {
  ...original,
  rootDir: API,
  roots: [corpus],
  testRegex: "dual-backend\\.spec\\.cjs$",
  moduleFileExtensions: [...original.moduleFileExtensions, "cjs"],
  modulePaths: [path.join(API, "node_modules")],
  moduleNameMapper: {
    ...original.moduleNameMapper,
    "^\\./safety\\.cjs$": path.join(__dirname, "current-safety.cjs"),
  },
  transform: {
    ...original.transform,
    "^.+\\.cjs$": path.join(__dirname, "corpus-transformer.cjs"),
  },
  globalSetup: path.join(__dirname, "global-setup.cjs"),
  reporters: ["default"],
  cacheDirectory: path.join(process.env.PG_ANALYSIS_OUTPUT, "jest-cache"),
  testTimeout: 60000,
};
