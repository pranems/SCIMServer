const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");

const ROOT = path.resolve(__dirname, "..", "..");
const API = path.join(ROOT, "api");
const OWNER = "4d48341f-c932-46bf-8171-8534c52447b1";
const INERT =
  "postgresql://127.0.0.1:1/scim_fresh_inmemory_never_connect";
const HISTORICAL_CORPUS = path.join(
  "docs",
  "evidence",
  "scim-fresh-20260925",
  "repro-postgres",
);
const CORPUS_HASHES = {
  "dual-backend.spec.cjs":
    "f50a16b4d2f4b7a66336a3820e2fe5128ced11073e1cbdf4a1577e18cb17ad05",
  "alias-cases.cjs":
    "45678fc0b22aa6d9245dee841cd21e6bad318c0b7b71babb68e850e384783a60",
  "run.cjs":
    "53379cedd7d87f4d4d1e9448649dbcf159f60b4e386d057ef32f04e59ae09e39",
  "safety.cjs":
    "7c0bdc02d703be72e70088f7019072a1702c3b19d6b9a96757d6b649013d3efe",
};
const git = (...args) =>
  cp
    .execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
const BASE = git("rev-parse", "HEAD");
const docker = (...args) =>
  cp
    .execFileSync("docker", args, { encoding: "utf8", windowsHide: true })
    .trim();

function sourceGuard() {
  assert.equal(
    path.basename(ROOT).toLowerCase(),
    "scimserver-scim-consolidation",
    "Current acceptance requires the consolidation worktree.",
  );
  assert.equal(
    git("branch", "--show-current"),
    "integrate/scim-correctness-20260928",
    "Current acceptance requires the consolidation branch.",
  );
  cp.execFileSync(
    "git",
    [
      "-C",
      ROOT,
      "merge-base",
      "--is-ancestor",
      "7332fdbcc70762a8f5ace4c5a63c67b00582eb87",
      "HEAD",
    ],
    { windowsHide: true },
  );
  cp.execFileSync(
    "git",
    [
      "-C",
      ROOT,
      "diff",
      "--quiet",
      "HEAD",
      "--",
      "api",
      "package.json",
      "package-lock.json",
    ],
    { windowsHide: true },
  );
  cp.execFileSync(
    "git",
    ["-C", ROOT, "diff", "--quiet", "HEAD", "--", HISTORICAL_CORPUS],
    { windowsHide: true },
  );
  for (const [file, expected] of Object.entries(CORPUS_HASHES)) {
    const source = fs
      .readFileSync(path.join(ROOT, HISTORICAL_CORPUS, file), "utf8")
      .replace(/\r\n/g, "\n");
    assert.equal(
      crypto.createHash("sha256").update(source).digest("hex"),
      expected,
      `Immutable historical corpus changed: ${file}`,
    );
  }
  assert.equal(
    fs.existsSync(path.join(API, "test", "e2e", ".test-db-path")),
    false,
    "Refusing existing database marker: do not read or overwrite another run's database URL.",
  );
  return { head: BASE, branch: git("branch", "--show-current") };
}

function containerGuard() {
  const id = process.env.PG_ANALYSIS_CONTAINER_ID;
  const run = process.env.PG_ANALYSIS_RUN;
  assert.match(id ?? "", /^[a-f0-9]{64}$/);
  assert.match(run ?? "", /^[a-f0-9]{16}$/);
  const container = JSON.parse(docker("inspect", id))[0];
  assert.equal(container.Id, id);
  assert.equal(container.Name, `/scim-fresh-pg-${run}`);
  assert.equal(container.Config.Labels["scim.analysis.owner"], OWNER);
  assert.equal(container.Config.Labels["scim.analysis.run"], run);
  assert.equal(container.State.Running, true);
  assert.equal(container.HostConfig.NetworkMode, "bridge");
  assert.ok(
    container.Mounts.every((mount) => mount.Type === "tmpfs"),
    "No bind or persistent volume allowed.",
  );
  assert.ok(container.HostConfig.Tmpfs["/var/lib/postgresql/data"]);
  const ports = container.NetworkSettings.Ports["5432/tcp"];
  assert.equal(ports.length, 1);
  assert.equal(ports[0].HostIp, "127.0.0.1");
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, ports[0].HostPort);
  assert.equal(url.pathname, `/scim_fresh_${run}`);
  assert.equal(url.username, "fresh_runner");
  assert.ok(url.password.length >= 32);
  assert.equal(url.search, "");
  return {
    id,
    name: container.Name.slice(1),
    owner: OWNER,
    run,
    imageId: container.Image,
    host: "127.0.0.1",
    port: Number(url.port),
    database: url.pathname.slice(1),
    mounts: container.Mounts.map((mount) => ({
      type: mount.Type,
      destination: mount.Destination,
    })),
    tmpfs: container.HostConfig.Tmpfs,
    network: container.HostConfig.NetworkMode,
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
          inet_server_addr()::text AS server_address, inet_server_port() AS server_port,
          system_identifier::text FROM pg_control_system()
      `)
    ).rows[0];
    assert.equal(identity.database, container.database);
    assert.equal(identity.username, "fresh_runner");
    assert.equal(identity.cluster_name, `scim-fresh-${container.run}`);
    assert.equal(identity.server_port, 5432);
    if (process.env.PG_ANALYSIS_SYSTEM_ID) {
      assert.equal(
        identity.system_identifier,
        process.env.PG_ANALYSIS_SYSTEM_ID,
      );
    }
    if (marker) {
      const rows = (
        await client.query("SELECT owner, run FROM analysis_guard.ownership")
      ).rows;
      assert.deepEqual(rows, [{ owner: OWNER, run: container.run }]);
    }
    return { container, server: identity };
  } finally {
    await client.end();
  }
}

async function testGuard() {
  sourceGuard();
  const backend = process.env.PERSISTENCE_BACKEND;
  assert.ok(
    ["prisma", "inmemory"].includes(backend),
    "Explicit backend is required.",
  );
  const output = path.resolve(process.env.PG_ANALYSIS_OUTPUT ?? "");
  assert.ok(
    output.startsWith(path.join(ROOT, "test-results") + path.sep),
    "Evidence must stay in this worktree's owned test-results directory.",
  );
  if (backend === "prisma") return databaseGuard();
  assert.equal(process.env.DATABASE_URL, INERT);
  return { backend: "inmemory", database: "not connected" };
}

module.exports = {
  CURRENT_SOURCE: true,
  ROOT,
  API,
  BASE,
  OWNER,
  INERT,
  CORPUS_HASHES,
  docker,
  sourceGuard,
  containerGuard,
  databaseGuard,
  testGuard,
};
