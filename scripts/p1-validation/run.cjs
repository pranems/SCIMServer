const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { ROOT, API, OWNER, IS_P7, docker, sourceGuard, containerGuard, databaseGuard } = require("./safety.cjs");

const source = sourceGuard();
const { Client } = require(path.join(API, "node_modules", "pg"));
const run = crypto.randomBytes(8).toString("hex");
const password = crypto.randomBytes(36).toString("base64url");
const output = path.join(ROOT, "test-results", IS_P7 ? "p7" : "p1", `backends-${run}`);
fs.mkdirSync(output, { recursive: true });
process.env.P1_SOURCE_SHA256 = source.sourceSha256;
process.env.PG_ANALYSIS_RUN = run;
process.env.PG_ANALYSIS_OUTPUT = output;
const receipt = { source, owner: OWNER, run, startedAt: new Date().toISOString(), backends: [], cleanup: {} };
const clean = text => String(text).split(password).join("[REDACTED]")
  .replace(/postgres(?:ql)?:\/\/[^@\s"']+@/gi, "postgresql://[REDACTED]@");
const save = () => fs.writeFileSync(path.join(output, "run.json"), JSON.stringify(receipt, null, 2));
let containerId;

function command(label, args) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd: API, env: process.env, encoding: "utf8", windowsHide: true, maxBuffer: 50 * 1024 * 1024,
  });
  fs.writeFileSync(path.join(output, `${label}.log`), clean(`${result.stdout ?? ""}\n${result.stderr ?? ""}`));
  assert.equal(result.error, undefined, `${label} launch failed`);
  return result.status;
}

async function smoke(backend) {
  const port = await new Promise(resolve => {
    const server = require("node:net").createServer();
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
  const secret = crypto.randomBytes(36).toString("base64url");
  const runtime = cp.spawn(process.execPath, [path.join(API, "dist", "main.js")], {
    cwd: API, windowsHide: true,
    env: { ...process.env, PORT: String(port), SCIM_SHARED_SECRET: secret,
      JWT_SECRET: secret, OAUTH_CLIENT_SECRET: secret, LOG_FILE: "", LOG_LEVEL: "OFF",
      NODE_ENV: "test", PUBLIC_URL: `http://127.0.0.1:${port}` },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  runtime.stdout.on("data", chunk => { log += chunk; });
  runtime.stderr.on("data", chunk => { log += chunk; });
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (runtime.exitCode !== null) throw new Error("Owned runtime exited before readiness");
      try {
        const response = await fetch(`http://127.0.0.1:${port}/scim/admin/endpoints`, {
          headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(500),
        });
        if (response.status === 200) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "Owned runtime did not authenticate the task credential");
    const result = IS_P7
      ? await require("../live-test-p7.cjs").runLiveP7(`http://127.0.0.1:${port}`, secret)
      : await require("../live-test-p1.cjs").runLiveP1(`http://127.0.0.1:${port}`, secret);
    return { ...result, pid: runtime.pid, port, runtimeStopped: true };
  } finally {
    const exited = new Promise(resolve => runtime.once("exit", resolve));
    if (runtime.exitCode === null) { runtime.kill(); await exited; }
    fs.writeFileSync(path.join(output, `${backend}-runtime.log`), clean(log).split(secret).join("[REDACTED]"));
  }
}

async function main() {
  receipt.docker = docker("version", "--format", "{{.Server.Version}}");
  docker("image", "inspect", "postgres:17-alpine", "--format", "{{.Id}}");
  containerId = cp.execFileSync("docker", [
    "run", "-d", "--pull=never", "--name", `scim-p1-pg-${run}`,
    "--label", `scim.p1.owner=${OWNER}`, "--label", `scim.p1.run=${run}`,
    "--network", "bridge", "--publish", "127.0.0.1::5432",
    "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_PASSWORD",
    "--env", "POSTGRES_USER=p1_runner", "--env", `POSTGRES_DB=scim_p1_${run}`,
    "postgres:17-alpine", "postgres", "-c", `cluster_name=scim-p1-${run}`,
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, POSTGRES_PASSWORD: password } }).trim();
  process.env.PG_ANALYSIS_CONTAINER_ID = containerId;
  const port = JSON.parse(docker("inspect", containerId))[0].NetworkSettings.Ports["5432/tcp"][0].HostPort;
  const url = `postgresql://p1_runner:${password}@127.0.0.1:${port}/scim_p1_${run}`;
  process.env.DATABASE_URL = url;
  receipt.container = containerGuard();
  save();
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const result = cp.spawnSync("docker", ["exec", containerId, "pg_isready", "-U", "p1_runner", "-d", `scim_p1_${run}`], { windowsHide: true });
    if (result.status === 0) { ready = true; break; }
    assert.ok([1, 2].includes(result.status), "Unexpected database readiness failure");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready);
  receipt.beforeMigration = await databaseGuard({ marker: false });
  process.env.PG_ANALYSIS_SYSTEM_ID = receipt.beforeMigration.server.system_identifier;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const tables = (await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'")).rows[0].n;
    assert.equal(tables, 0, "Refusing a pre-populated database");
    await client.query("CREATE SCHEMA analysis_guard");
    await client.query("CREATE TABLE analysis_guard.ownership(owner text NOT NULL, run text NOT NULL)");
    await client.query("INSERT INTO analysis_guard.ownership VALUES ($1,$2)", [OWNER, run]);
    await client.query('CREATE EXTENSION "uuid-ossp"');
  } finally { await client.end(); }
  await databaseGuard();
  receipt.migrationExit = command("migration-replay", [path.join(API, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"]);
  assert.equal(receipt.migrationExit, 0);
  const verify = new Client({ connectionString: url });
  await verify.connect();
  try {
    receipt.migrations = (await verify.query('SELECT migration_name, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" ORDER BY migration_name')).rows;
    const expected = fs.readdirSync(path.join(API, "prisma", "migrations"), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort();
    assert.deepEqual(receipt.migrations.map(m => m.migration_name), expected);
    assert.ok(receipt.migrations.every(m => m.finished));
  } finally { await verify.end(); }
  for (const backend of ["inmemory", "prisma"]) {
    process.env.PERSISTENCE_BACKEND = backend;
    process.env.DATABASE_URL = backend === "prisma" ? url : "postgresql://127.0.0.1:1/scim_p1_inmemory_never_connect";
    process.env.NODE_ENV = "test";
    process.env.LOG_LEVEL = "OFF";
    process.env.LOG_FILE = "";
    if (backend === "prisma") await databaseGuard();
    const resultFile = path.join(output, `${backend}.json`);
    const exit = command(`${backend}-http`, [
      path.join(API, "node_modules", "jest", "bin", "jest.js"), "--config", path.join(__dirname, "jest.config.cjs"),
      "--runInBand", "--forceExit", "--json", "--outputFile", resultFile,
    ]);
    const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
    const lane = { backend, exit, passed: result.numPassedTests, failed: result.numFailedTests, total: result.numTotalTests };
    receipt.backends.push(lane);
    save();
    assert.equal(exit, 0, `${backend} HTTP tests failed`);
    assert.equal(result.numFailedTests, 0);
    assert.ok(result.numPassedTests >= (IS_P7 ? 67 : 24), "Missing permanent package cases");
    lane.live = await smoke(backend);
    save();
  }
  sourceGuard();
  receipt.status = "passed";
}
main().catch(error => {
  receipt.status = "failed";
  receipt.failure = clean(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(() => {
  if (containerId) {
    try {
      const c = JSON.parse(docker("inspect", containerId))[0];
      assert.equal(c.Id, containerId);
      assert.equal(c.Config.Labels["scim.p1.owner"], OWNER);
      assert.equal(c.Config.Labels["scim.p1.run"], run);
      docker("rm", "--force", containerId);
      assert.equal(docker("ps", "--all", "--filter", `id=${containerId}`, "--format", "{{.ID}}"), "");
      receipt.cleanup = { exactId: containerId, removed: true };
    } catch (error) { receipt.cleanup = { error: clean(error.message) }; process.exitCode = 1; }
  }
  receipt.finishedAt = new Date().toISOString();
  save();
  console.log(JSON.stringify({ status: receipt.status, output: path.relative(ROOT, output), backends: receipt.backends, cleanup: receipt.cleanup }, null, 2));
});
