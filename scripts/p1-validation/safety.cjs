const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");
const API = path.join(ROOT, "api");
const IS_P7 = path.basename(ROOT).toLowerCase() === "scimserver-scim-profile-validation";
const BASE = IS_P7 ? "3ecaba55df5424b5427b8fdc41c1bdad0b8d0f51" : "cb2e1bcb4ad31366ef972ac5a163e8aae0e0707e";
const OWNER = "bf8209ca-96fe-46aa-8cab-1641c725a077";
const docker = (...args) =>
  cp
    .execFileSync("docker", args, { encoding: "utf8", windowsHide: true })
    .trim();

function sourceGuard() {
  const git = (...args) => cp.execFileSync("git", ["-C", ROOT, ...args], { encoding: "utf8" }).trim();
  assert.equal(path.basename(ROOT).toLowerCase(), IS_P7 ? "scimserver-scim-profile-validation" : "scimserver-scim-implementation");
  assert.equal(git("branch", "--show-current"), IS_P7 ? "fix/scim-profile-validation-20260928" : "fix/scim-correctness-p1-20260928");
  git("merge-base", "--is-ancestor", BASE, "HEAD");
  assert.equal(
    fs.existsSync(path.join(API, "test", "e2e", ".test-db-path")),
    false,
    "Refusing existing database marker: do not read or overwrite another run's database URL.",
  );
  const hash = require("node:crypto").createHash("sha256");
  const files = git("ls-files", "-co", "--exclude-standard", "--",
    "api/src", "api/test", "api/prisma", "scripts/p1-validation", "scripts/live-test-p1.cjs", "scripts/live-test-p7.cjs",
  ).split("\n").filter(Boolean).sort();
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(ROOT, file)));
  }
  const source = { base: BASE, head: git("rev-parse", "HEAD"), sourceSha256: hash.digest("hex"), fileCount: files.length };
  if (process.env.P1_SOURCE_SHA256) assert.equal(source.sourceSha256, process.env.P1_SOURCE_SHA256);
  return source;
}

function containerGuard() {
  const id = process.env.PG_ANALYSIS_CONTAINER_ID;
  const run = process.env.PG_ANALYSIS_RUN;
  assert.match(id ?? "", /^[a-f0-9]{64}$/);
  assert.match(run ?? "", /^[a-f0-9]{16}$/);
  const c = JSON.parse(docker("inspect", id))[0];
  assert.equal(c.Id, id);
  assert.equal(c.Name, `/scim-p1-pg-${run}`);
  assert.equal(c.Config.Labels["scim.p1.owner"], OWNER);
  assert.equal(c.Config.Labels["scim.p1.run"], run);
  assert.equal(c.State.Running, true);
  assert.equal(c.HostConfig.NetworkMode, "bridge");
  assert.ok(
    c.Mounts.every((m) => m.Type === "tmpfs"),
    "No bind or persistent volume allowed.",
  );
  assert.ok(c.HostConfig.Tmpfs["/var/lib/postgresql/data"]);
  const ports = c.NetworkSettings.Ports["5432/tcp"];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].HostIp, "127.0.0.1");
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, ports[0].HostPort);
  assert.equal(url.pathname, `/scim_p1_${run}`);
  assert.equal(url.username, "p1_runner");
  assert.ok(url.password.length >= 32);
  assert.equal(url.search, "");
  return {
    id,
    name: c.Name.slice(1),
    owner: OWNER,
    run,
    imageId: c.Image,
    host: "127.0.0.1",
    port: Number(url.port),
    database: url.pathname.slice(1),
    mounts: c.Mounts.map((m) => ({ type: m.Type, destination: m.Destination })),
    tmpfs: c.HostConfig.Tmpfs,
    network: c.HostConfig.NetworkMode,
  };
}

async function databaseGuard({ marker = true } = {}) {
  const container = containerGuard();
  const { Client } = require(path.join(API, "node_modules", "pg"));
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  try {
    const identity = (
      await client.query(`
      SELECT current_database() AS database, current_user AS username,
        current_setting('cluster_name') AS cluster_name, version() AS version,
        current_setting('server_version_num')::int AS server_version_num,
        inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
        system_identifier::text FROM pg_control_system()
    `)
    ).rows[0];
    assert.equal(identity.database, container.database);
    assert.equal(identity.username, "p1_runner");
    assert.equal(identity.cluster_name, `scim-p1-${container.run}`);
    assert.equal(identity.server_port, 5432);
    assert.ok(identity.server_version_num >= 170008 && identity.server_version_num < 180000, "PostgreSQL 17.8+ required");
    if (process.env.PG_ANALYSIS_SYSTEM_ID)
      assert.equal(
        identity.system_identifier,
        process.env.PG_ANALYSIS_SYSTEM_ID,
      );
    if (marker) {
      const row = (
        await client.query("SELECT owner, run FROM analysis_guard.ownership")
      ).rows;
      assert.deepEqual(row, [{ owner: OWNER, run: container.run }]);
    }
    return { container, server: identity };
  } finally {
    await client.end();
  }
}

async function testGuard() {
  sourceGuard();
  const mode = process.env.PERSISTENCE_BACKEND;
  assert.ok(
    ["prisma", "inmemory"].includes(mode),
    "Explicit backend is required.",
  );
  assert.ok(
    process.env.PG_ANALYSIS_OUTPUT?.startsWith(
      path.join(ROOT, "test-results") + path.sep,
    ),
  );
  if (mode === "prisma") return databaseGuard();
  assert.equal(
    process.env.DATABASE_URL,
    "postgresql://127.0.0.1:1/scim_p1_inmemory_never_connect",
  );
  return { backend: "inmemory", database: "not connected" };
}

module.exports = {
  ROOT,
  API,
  BASE,
  IS_P7,
  OWNER,
  docker,
  sourceGuard,
  containerGuard,
  databaseGuard,
  testGuard,
};
