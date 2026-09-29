const fs = require("node:fs"),
  path = require("node:path"),
  cp = require("node:child_process"),
  Module = require("node:module");
const { BASE, OUTPUT, prepare, registerTypeScript } = require("./runtime.cjs");
prepare();
const ts = require(path.resolve("api/node_modules/typescript"));
registerTypeScript();
const file = "api/src/modules/scim/utils/scim-patch-path.ts";
const urn = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const rows = [];
for (const ref of [
  "9d7be46ba86f53aa9cc6cee4ba64882b801c877a",
  "99571dd83efe7accd92ab7dda966d27c6a691853^",
  "99571dd83efe7accd92ab7dda966d27c6a691853",
  "c10f9ea83822a50650c2b2867ceff9eeaa46c545",
  "bca4f6b46f584dfd3c233ec2956d610f9b7f47d3",
  "ccde1d5d6b5129dd943c6e848989c668a0d00d7a",
]) {
  const sha = cp
    .execFileSync("git", ["rev-parse", ref], { encoding: "utf8" })
    .trim();
  cp.execFileSync("git", ["merge-base", "--is-ancestor", sha, BASE]);
  const source = cp.execFileSync("git", ["show", `${sha}:${file}`], {
    encoding: "utf8",
  });
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const m = new Module(path.resolve(file), module);
  m.filename = path.resolve(file);
  m.paths = Module._nodeModulePaths(path.dirname(m.filename));
  m._compile(compiled, m.filename);
  rows.push({
    sha,
    ref,
    sourceFile: file,
    booleanCore: m.exports.parseValuePath("contacts[primary eq true].value"),
    stringCore: m.exports.parseValuePath('contacts[type eq "work"].value'),
    booleanExtension: m.exports.parseExtensionPath(
      `${urn}:contacts[primary eq true].value`,
      [urn],
    ),
    stringExtension: m.exports.parseExtensionPath(
      `${urn}:contacts[type eq "work"].value`,
      [urn],
    ),
  });
}
fs.writeFileSync(
  path.join(OUTPUT, "history-parser.json"),
  JSON.stringify(
    {
      method:
        "Unmodified historical utility source transpiled by installed TypeScript; relative constants import resolves pinned master. Enterprise URN common to all versions is explicitly selected. Every SHA verified ancestor of pinned source.",
      rows,
    },
    null,
    2,
  ),
);
console.log(
  rows.map((r) => ({
    sha: r.sha,
    booleanCore: r.booleanCore,
    booleanExtension: r.booleanExtension,
  })),
);
