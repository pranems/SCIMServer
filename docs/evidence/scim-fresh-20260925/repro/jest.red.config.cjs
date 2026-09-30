const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { API, OUTPUT, prepare } = require("./runtime.cjs");
prepare({ changeDirectory: false });

// Load only the existing config; Jest must own the global TypeScript hooks.
const ts = require(path.join(API, "node_modules", "typescript"));
const configFile = path.join(API, "test", "e2e", "jest-e2e.config.ts");
const compiled = ts.transpileModule(fs.readFileSync(configFile, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const configModule = new Module(configFile, module);
configModule.filename = configFile;
configModule.paths = Module._nodeModulePaths(path.dirname(configFile));
configModule._compile(compiled, configFile);
const original = configModule.exports.default;

module.exports = {
  ...original,
  rootDir: API,
  roots: [__dirname],
  moduleFileExtensions: [...original.moduleFileExtensions, "cjs"],
  modulePaths: [path.join(API, "node_modules")],
  testRegex: "http-probes\\.spec\\.cjs$",
  cacheDirectory: path.join(OUTPUT, "jest-cache"),
  reporters: ["default"],
};
