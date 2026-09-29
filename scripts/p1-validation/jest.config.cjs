const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { API, IS_P7, IS_P9, sourceGuard } = require("./safety.cjs");
sourceGuard();
const ts = require(path.join(API, "node_modules", "typescript"));
const file = path.join(API, "test", "e2e", "jest-e2e.config.ts");
const loaded = new Module(file, module);
loaded.filename = file;
loaded.paths = Module._nodeModulePaths(path.dirname(file));
loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, file);
const { globalTeardown, ...original } = loaded.exports.default;
module.exports = {
  ...original, rootDir: API,
  testRegex: IS_P9 ? "entra-compatibility\\.e2e-spec\\.ts$" : IS_P7 ? "profile-validation-p7\\.e2e-spec\\.ts$" : "typed-patch-path\\.e2e-spec\\.ts$",
  globalSetup: path.join(__dirname, "setup.cjs"),
  reporters: ["default"],
  cacheDirectory: path.join(process.env.PG_ANALYSIS_OUTPUT, "jest-cache"),
};
