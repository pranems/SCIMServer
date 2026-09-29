const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { API, sourceGuard } = require("./safety.cjs");
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
module.exports = {
  ...original,
  rootDir: API,
  roots: [path.join(API, "test", "e2e")],
  testRegex: process.env.PERSISTENCE_TEST_SUITE === "group-transactions"
    ? "(group-aggregate|group-lifecycle|group-parity-gaps|conditional-writes|etag-conditional)\\.e2e-spec\\.ts$"
    : process.env.PERSISTENCE_TEST_SUITE === "atomic-uniqueness"
    ? "(atomic-uniqueness|schema-driven-uniqueness|group-aggregate|conditional-writes|etag-conditional)\\.e2e-spec\\.ts$"
    : "(conditional-writes|etag-conditional)\\.e2e-spec\\.ts$",
  moduleFileExtensions: [...original.moduleFileExtensions, "cjs"],
  modulePaths: [path.join(API, "node_modules")],
  globalSetup: path.join(__dirname, "global-setup.cjs"),
  reporters: ["default"],
  cacheDirectory: path.join(process.env.PG_ANALYSIS_OUTPUT, "jest-cache"),
  testTimeout: 60000,
};
