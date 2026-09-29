// Negative control: compile pinned P1 production source in memory, without
// overwriting the working tree or accessing another worktree's source.
const path = require("node:path");
const cp = require("node:child_process");
const { API, ROOT, BASE, sourceGuard } = require("./safety.cjs");
sourceGuard();
const transformer = require(path.join(API, "node_modules", "ts-jest")).default;
const changed = new Set(cp.execFileSync("git", [
  "-C", ROOT, "diff", "--name-only", BASE, "--", "api/src",
], { encoding: "utf8" }).trim().split("\n").filter(file => !file.endsWith(".spec.ts")));
module.exports = {
  createTransformer(options) {
    const delegate = transformer.createTransformer(options);
    const baseline = (source, filename) => {
      const relative = path.relative(ROOT, filename).split(path.sep).join("/");
      return changed.has(relative)
        ? cp.execFileSync("git", ["-C", ROOT, "show", `${BASE}:${relative}`], { encoding: "utf8" })
        : source;
    };
    return {
      ...delegate,
      getCacheKey(source, filename, config) {
        return delegate.getCacheKey(baseline(source, filename), filename, config);
      },
      process(source, filename, config) {
        return delegate.process(baseline(source, filename), filename, config);
      },
    };
  },
};
