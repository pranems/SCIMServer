const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const BASE = "ccde1d5d6b5129dd943c6e848989c668a0d00d7a";
const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const API = path.join(ROOT, "api");
const OUTPUT = path.join(ROOT, "test-results", "fresh-analysis", "repro");
const DATABASE_URL =
  "postgresql://127.0.0.1:1/scim_fresh_analysis_never_connect";

function prepare({ changeDirectory = true } = {}) {
  const head = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  if (head !== BASE) {
    throw new Error(
      `Refusing a different source baseline: ${head}; expected ${BASE}.`,
    );
  }
  execFileSync("git", [
    "-C",
    ROOT,
    "diff",
    "--quiet",
    BASE,
    "--",
    "api",
    "web",
    "scripts",
    "package.json",
    "package-lock.json",
  ]);
  if (changeDirectory) process.chdir(ROOT);
  process.env.PERSISTENCE_BACKEND = "inmemory";
  process.env.DATABASE_URL = DATABASE_URL;
  process.env.NODE_ENV = "test";
  process.env.LOG_FILE = "";
  fs.mkdirSync(OUTPUT, { recursive: true });
}

function registerTypeScript() {
  require(path.join(API, "node_modules", "ts-node")).register({
    project: path.join(API, "tsconfig.json"),
    transpileOnly: true,
  });
}

module.exports = {
  BASE,
  ROOT,
  API,
  OUTPUT,
  DATABASE_URL,
  prepare,
  registerTypeScript,
};

if (require.main === module) {
  prepare();
  console.log(`Pinned source verified: ${BASE}; synthetic InMemory only.`);
}
