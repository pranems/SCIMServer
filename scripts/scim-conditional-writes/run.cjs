const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const {
  ROOT,
  API,
  BASE,
  OWNER,
  docker,
  sourceGuard,
  containerGuard,
  databaseGuard,
} = require("./safety.cjs");
sourceGuard();
assert.equal(process.argv.length, 2, "No external database or arguments accepted.");
const suite = process.env.PERSISTENCE_TEST_SUITE ?? "conditional-writes";
assert.ok(["conditional-writes", "group-transactions"].includes(suite), "Unknown persistence suite.");
delete process.env.DATABASE_URL;
const { Client } = require(path.join(API, "node_modules", "pg"));
const run = crypto.randomBytes(8).toString("hex");
const password = crypto.randomBytes(36).toString("base64url");
const output = path.join(
  ROOT,
  "test-results",
  suite,
  `postgres-${run}`,
);
fs.mkdirSync(output, { recursive: true });
process.env.PG_ANALYSIS_RUN = run;
process.env.PG_ANALYSIS_OUTPUT = output;
const receipt = {
  base: BASE,
  owner: OWNER,
  run,
  startedAt: new Date().toISOString(),
  output: path.relative(ROOT, output),
  status: "starting",
  backendResults: [],
  cleanup: {},
};
receipt.sourceDiffSha256 = crypto.createHash("sha256").update(
  cp.execFileSync("git", ["-C", ROOT, "diff", "HEAD", "--", "api", "scripts"]),
).digest("hex");
const sourceHash = crypto.createHash("sha256");
for (const file of cp.execFileSync("git", [
  "-C", ROOT, "ls-files", "--cached", "--others", "--exclude-standard", "--", "api", "scripts",
], { encoding: "utf8" }).trim().split(/\r?\n/).sort()) {
  const absolute = path.join(ROOT, file);
  if (fs.existsSync(absolute)) sourceHash.update(file).update(fs.readFileSync(absolute));
}
receipt.sourceTreeSha256 = sourceHash.digest("hex");
const clean = (text) =>
  String(text)
    .split(password)
    .join("[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^@\s"']+@/gi, "postgresql://[REDACTED]@");
const save = () =>
  fs.writeFileSync(
    path.join(output, "run.json"),
    JSON.stringify(receipt, null, 2),
  );
let containerId;

function command(label, args, cwd = API, env = process.env) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  });
  fs.writeFileSync(
    path.join(output, `${label}.log`),
    clean(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
  );
  if (result.error)
    throw new Error(`${label} process failed: ${clean(result.error.message)}`);
  return result.status;
}

async function main() {
  receipt.dockerServerVersion = docker(
    "version",
    "--format",
    "{{.Server.Version}}",
  );
  receipt.image = "postgres:17-alpine";
  docker("image", "inspect", receipt.image, "--format", "{{.Id}}");
  containerId = cp
    .execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--pull=never",
        "--name",
        `scim-p3-pg-${run}`,
        "--label",
        `scim.analysis.owner=${OWNER}`,
        "--label",
        `scim.analysis.run=${run}`,
        "--network",
        "bridge",
        "--publish",
        "127.0.0.1::5432",
        "--tmpfs",
        "/var/lib/postgresql/data:rw",
        "--env",
        "POSTGRES_PASSWORD",
        "--env",
        "POSTGRES_USER=fresh_runner",
        "--env",
        `POSTGRES_DB=scim_fresh_${run}`,
        receipt.image,
        "postgres",
        "-c",
        `cluster_name=scim-fresh-${run}`,
      ],
      {
        encoding: "utf8",
        env: { ...process.env, POSTGRES_PASSWORD: password },
        windowsHide: true,
      },
    )
    .trim();
  process.env.PG_ANALYSIS_CONTAINER_ID = containerId;
  const inspect = JSON.parse(docker("inspect", containerId))[0];
  const port = inspect.NetworkSettings.Ports["5432/tcp"][0].HostPort;
  const url = `postgresql://fresh_runner:${password}@127.0.0.1:${port}/scim_fresh_${run}`;
  process.env.DATABASE_URL = url;
  receipt.container = containerGuard();
  save();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const r = cp.spawnSync(
      "docker",
      [
        "exec",
        containerId,
        "pg_isready",
        "-U",
        "fresh_runner",
        "-d",
        `scim_fresh_${run}`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (r.status === 0) {
      ready = true;
      break;
    }
    if (![1, 2].includes(r.status))
      throw new Error(`Unexpected readiness failure: ${clean(r.stderr)}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Task PostgreSQL did not become ready.");
  receipt.beforeMigration = await databaseGuard({ marker: false });
  if (suite === "group-transactions")
    assert.match(receipt.beforeMigration.server.version, /^PostgreSQL 17\.8 /);
  process.env.PG_ANALYSIS_SYSTEM_ID =
    receipt.beforeMigration.server.system_identifier;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = (
      await client.query(
        "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
      )
    ).rows[0].n;
    assert.equal(tables, 0, "Refusing a pre-populated database.");
    await client.query("CREATE SCHEMA analysis_guard");
    await client.query(
      "CREATE TABLE analysis_guard.ownership(owner text NOT NULL, run text NOT NULL)",
    );
    await client.query("INSERT INTO analysis_guard.ownership VALUES ($1,$2)", [
      OWNER,
      run,
    ]);
    // The three required extensions are supplied by the migration itself.
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  } finally {
    await client.end();
  }
  await databaseGuard();
  receipt.migrationExit = command("migration-replay", [
    path.join(API, "node_modules", "prisma", "build", "index.js"),
    "migrate",
    "deploy",
  ]);
  assert.equal(
    receipt.migrationExit,
    0,
    "Migration replay failed; no tests started.",
  );
  const verify = new Client({ connectionString: url });
  await verify.connect();
  try {
    receipt.migrations = (
      await verify.query(
        'SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
    receipt.extensions = (
      await verify.query(
        "SELECT extname, extversion FROM pg_extension ORDER BY extname",
      )
    ).rows;
    const expected = fs
      .readdirSync(path.join(API, "prisma", "migrations"), {
        withFileTypes: true,
      })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    assert.deepEqual(
      receipt.migrations.map((m) => m.migration_name),
      expected,
    );
    assert.ok(receipt.migrations.every((m) => m.finished && !m.rolled_back));
  } finally {
    await verify.end();
  }
  receipt.status = "running-corpus";
  save();
  for (const backend of ["inmemory", "prisma"]) {
    process.env.PERSISTENCE_BACKEND = backend;
    process.env.DATABASE_URL =
      backend === "prisma"
        ? url
        : "postgresql://127.0.0.1:1/scim_fresh_inmemory_never_connect";
    process.env.LOG_LEVEL = "OFF";
    process.env.LOG_FILE = "";
    process.env.NODE_ENV = "test";
    if (backend === "prisma") await databaseGuard();
    const jest = path.join(API, "node_modules", "jest", "bin", "jest.js");
    const config = path.join(__dirname, "jest.config.cjs");
    const listing = cp.spawnSync(
      process.execPath,
      [jest, "--config", config, "--listTests", "--json"],
      { cwd: API, env: process.env, encoding: "utf8" },
    );
    if (listing.status !== 0)
      throw new Error(`Discovery failed: ${clean(listing.stderr)}`);
    const tests = [
      path.join(API, "test", "e2e", "conditional-writes.e2e-spec.ts"),
      path.join(API, "test", "e2e", "etag-conditional.e2e-spec.ts"),
    ];
    if (suite === "group-transactions")
      tests.push(...["group-aggregate", "group-lifecycle", "group-parity-gaps"]
        .map((name) => path.join(API, "test", "e2e", `${name}.e2e-spec.ts`)));
    assert.deepEqual(JSON.parse(listing.stdout).sort(), [...tests].sort());
    const exitCode = command(`${backend}-corpus`, [
      jest,
      "--config",
      config,
      "--runTestsByPath",
      ...tests,
      "--runInBand",
      "--forceExit",
      "--json",
      "--outputFile", path.join(output, `${backend}.json`),
    ]);
    const resultPath = path.join(output, `${backend}.json`);
    assert.ok(
      fs.existsSync(resultPath),
      `${backend} did not write corpus evidence.`,
    );
    const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    assert.ok(result.numTotalTests > 0, "No executed assertions.");
    assert.ok([0, 1].includes(exitCode));
    receipt.backendResults.push({
      backend,
      exitCode,
      passed: result.numPassedTests,
      failed: result.numFailedTests,
      skipped: result.numPendingTests,
      failedSuites: result.numFailedTestSuites,
      setupFailedSuites: result.numRuntimeErrorTestSuites,
      file: path.relative(ROOT, resultPath),
    });
    save();
  }
  if (receipt.backendResults.some((r) => r.exitCode !== 0)) process.exitCode = 1;
  receipt.status = "complete";
}

main()
  .catch((error) => {
    receipt.status = "harness-failed";
    receipt.failure = clean(error.stack ?? error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (containerId) {
      try {
        // Recheck ownership by exact ID; cleanup does not use names or a wildcard.
        const c = JSON.parse(docker("inspect", containerId))[0];
        assert.equal(c.Id, containerId);
        assert.equal(c.Config.Labels["scim.analysis.owner"], OWNER);
        assert.equal(c.Config.Labels["scim.analysis.run"], run);
        docker("rm", "--force", containerId);
        const remaining = docker(
          "ps",
          "--all",
          "--quiet",
          "--no-trunc",
          "--filter",
          `id=${containerId}`,
        );
        assert.equal(remaining, "");
        receipt.cleanup = {
          exactContainerId: containerId,
          removed: true,
          persistentVolumesCreated: 0,
          customNetworksCreated: 0,
        };
      } catch (error) {
        receipt.cleanup = {
          exactContainerId: containerId,
          removed: false,
          error: clean(error.message),
        };
        process.exitCode = 1;
      }
    }
    receipt.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify(
        {
          status: receipt.status,
          output: receipt.output,
          migrations: receipt.migrations?.length,
          backendResults: receipt.backendResults,
          cleanup: receipt.cleanup,
        },
        null,
        2,
      ),
    );
  });
