const fs = require("node:fs");
const path = require("node:path");
const cp = require("node:child_process");
const crypto = require("node:crypto");
const net = require("node:net");
const assert = require("node:assert/strict");

const {
  ROOT,
  API,
  BASE,
  OWNER,
  INERT,
  docker,
  sourceGuard,
  containerGuard,
  databaseGuard,
} = require("../scim-acceptance-current/current-safety.cjs");

const pwsh = process.platform === "win32" ? "pwsh.exe" : "pwsh";
const REQUIRED_LIVE_OUTCOMES = [
  "9z-DE: 126 binding-qualified uniqueness",
  "9z-CV: 472 declaration",
  "9z-CY: 19 default-running Entra cases / 1228 assertions",
  "9z-DD: 6 PUT/PATCH retention stability cases / 5474 assertions",
  "9z-DF: 153 P7b PATCH/schema cases / 905 assertions",
];

function git(...args) {
  return cp
    .execFileSync("git", ["-C", ROOT, ...args], {
      encoding: "utf8",
      windowsHide: true,
    })
    .trim();
}

function buildCommand() {
  const npmCli =
    process.env.npm_execpath ??
    path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js",
    );
  assert.equal(
    fs.existsSync(npmCli),
    true,
    `Installed npm CLI not found: ${npmCli}`,
  );
  assert.equal(
    path.basename(npmCli),
    "npm-cli.js",
    "Build must use npm-cli.js through the current Node executable.",
  );
  return {
    file: process.execPath,
    args: [npmCli, "run", "build"],
  };
}

function buildRuntimeEnv({ backend, baseUrl, databaseUrl, secret }) {
  assert.ok(["inmemory", "prisma"].includes(backend));
  assert.equal(new URL(baseUrl).hostname, "localhost");
  return {
    ...process.env,
    PERSISTENCE_BACKEND: backend,
    DATABASE_URL: databaseUrl,
    NODE_ENV: "test",
    LOG_FILE: "",
    LOG_LEVEL: "OFF",
    PORT: String(new URL(baseUrl).port),
    PUBLIC_URL: baseUrl,
    SCIM_SHARED_SECRET: secret,
    JWT_SECRET: secret,
    OAUTH_CLIENT_ID: "scim-artifact-owned",
    OAUTH_CLIENT_SECRET: secret,
  };
}

function assertLiveReceipt(receipt) {
  assert.equal(receipt.failed, 0, "Exact artifact has a failed live assertion.");
  assert.equal(
    receipt.passed,
    166,
    "Unexpected exact-artifact live outcome count.",
  );
  assert.equal(
    receipt.checks.length,
    receipt.passed,
    "Live receipt count does not match its outcomes.",
  );
  assert.ok(
    receipt.checks.every(({ success }) => success === true),
    "Live receipt includes a non-passing outcome.",
  );
  for (const prefix of REQUIRED_LIVE_OUTCOMES) {
    assert.ok(
      receipt.checks.some(({ message }) => message.startsWith(prefix)),
      `Exact artifact is missing required live outcome: ${prefix}`,
    );
  }
}

function assertEmptyEndpointInventory(inventory) {
  assert.equal(
    Array.isArray(inventory?.endpoints),
    true,
    "Expected the canonical endpoint inventory envelope.",
  );
  assert.equal(
    inventory.endpoints.length,
    0,
    "Exact artifact requires an empty endpoint inventory.",
  );
  assert.equal(
    inventory.totalResults,
    0,
    "Exact artifact requires an empty endpoint inventory.",
  );
}

function assertOwnedContainerMetadata(container, { id, run }) {
  assert.equal(container.Id, id, "Container identity changed.");
  assert.equal(
    container.Name,
    `/scim-fresh-pg-${run}`,
    "Container name is outside the owned run.",
  );
  assert.equal(
    container.Config.Labels["scim.analysis.owner"],
    OWNER,
    "Container owner is outside this task.",
  );
  assert.equal(
    container.Config.Labels["scim.analysis.run"],
    run,
    "Container run label changed.",
  );
}

function redact(text, secrets) {
  let value = String(text ?? "");
  for (const secret of secrets) {
    if (secret) value = value.split(secret).join("[REDACTED]");
  }
  return value.replace(
    /postgres(?:ql)?:\/\/[^@\s"']+@/gi,
    "postgresql://[REDACTED]@",
  );
}

function execute(output, label, file, args, options = {}) {
  const result = cp.spawnSync(file, args, {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
  });
  fs.writeFileSync(
    path.join(output, `${label}.log`),
    redact(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, options.secrets ?? []),
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${label} failed with exit ${result.status}.`);
  return result;
}

function hashBuild() {
  const dist = path.join(API, "dist");
  const files = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".js")) files.push(absolute);
    }
  };
  walk(dist);
  files.sort();
  const hash = crypto.createHash("sha256");
  for (const file of files) {
    hash.update(path.relative(dist, file).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(fs.readFileSync(file));
  }
  return { sha256: hash.digest("hex"), files: files.length };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "localhost", () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

async function stopRuntime(runtime) {
  if (runtime.exitCode !== null || runtime.signalCode !== null) return;
  const stopped = new Promise((resolve) => runtime.once("exit", resolve));
  const result = cp.spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      `Stop-Process -Id ${runtime.pid} -Force -ErrorAction Stop`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  assert.equal(result.status, 0, `Could not stop owned runtime PID ${runtime.pid}.`);
  await Promise.race([
    stopped,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`Owned runtime PID ${runtime.pid} did not exit.`)),
        10000,
      ),
    ),
  ]);
}

async function runBuiltRuntime({
  backend,
  databaseUrl,
  output,
  secrets,
}) {
  const port = await freePort();
  const baseUrl = `http://localhost:${port}`;
  const secret = crypto.randomBytes(36).toString("base64url");
  secrets.push(secret);
  const env = buildRuntimeEnv({
    backend,
    baseUrl,
    databaseUrl,
    secret,
  });
  const runtime = cp.spawn(process.execPath, [path.join(API, "dist", "main.js")], {
    cwd: API,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let runtimeLog = "";
  runtime.stdout.on("data", (chunk) => {
    runtimeLog += chunk;
  });
  runtime.stderr.on("data", (chunk) => {
    runtimeLog += chunk;
  });
  const result = {
    backend,
    command: "node api/dist/main.js",
    pid: runtime.pid,
    baseUrl,
    stopped: false,
  };
  try {
    let before;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (runtime.exitCode !== null) {
        throw new Error(`Owned ${backend} runtime exited before readiness.`);
      }
      try {
        const response = await fetch(`${baseUrl}/scim/admin/endpoints`, {
          headers: { Authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(1000),
        });
        if (response.status === 200) {
          before = await response.json();
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(before, `Owned ${backend} runtime did not become ready.`);
    assertEmptyEndpointInventory(before);

    const liveFile = path.join(output, `${backend}-live.json`);
    const live = execute(
      output,
      `${backend}-live`,
      pwsh,
      [
        "-NoProfile",
        "-File",
        path.join(__dirname, "shared-live.ps1"),
      ],
      {
        env: {
          ...env,
          OWNED_LIVE_BASE: baseUrl,
          OWNED_LIVE_TOKEN: secret,
          OWNED_LIVE_RECEIPT: liveFile,
        },
        secrets,
      },
    );
    result.liveProcessExit = live.status;
    const receipt = JSON.parse(
      fs.readFileSync(liveFile, "utf8").replace(/^\uFEFF/, ""),
    );
    assertLiveReceipt(receipt);
    result.live = {
      passed: receipt.passed,
      failed: receipt.failed,
      requiredOutcomes: REQUIRED_LIVE_OUTCOMES,
    };

    const afterResponse = await fetch(`${baseUrl}/scim/admin/endpoints`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(afterResponse.status, 200);
    assert.deepEqual(await afterResponse.json(), before);
    result.endpointCollectionUnchanged = true;
  } finally {
    await stopRuntime(runtime);
    result.stopped = runtime.exitCode !== null || runtime.signalCode !== null;
    fs.writeFileSync(
      path.join(output, `${backend}-runtime.log`),
      redact(runtimeLog, secrets),
    );
  }
  return result;
}

async function startPostgres({
  run,
  password,
  output,
  receipt,
  secrets,
  onContainer,
}) {
  const imageId = docker(
    "image",
    "inspect",
    "postgres:17-alpine",
    "--format",
    "{{.Id}}",
  );
  const id = cp
    .execFileSync(
      "docker",
      [
        "run",
        "-d",
        "--pull=never",
        "--name",
        `scim-fresh-pg-${run}`,
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
        "postgres:17-alpine",
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
  process.env.PG_ANALYSIS_CONTAINER_ID = id;
  process.env.PG_ANALYSIS_RUN = run;
  receipt.container = { id, imageId };
  onContainer(id);

  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const check = cp.spawnSync(
      "docker",
      [
        "exec",
        id,
        "pg_isready",
        "-h",
        "127.0.0.1",
        "-U",
        "fresh_runner",
        "-d",
        `scim_fresh_${run}`,
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (check.status === 0) {
      ready = true;
      break;
    }
    assert.ok([1, 2].includes(check.status));
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Owned PostgreSQL did not become ready.");

  const container = JSON.parse(docker("inspect", id))[0];
  const port = container.NetworkSettings.Ports["5432/tcp"][0].HostPort;
  const databaseUrl =
    `postgresql://fresh_runner:${password}@127.0.0.1:${port}/` +
    `scim_fresh_${run}`;
  process.env.DATABASE_URL = databaseUrl;
  secrets.push(password, databaseUrl);

  const identity = await databaseGuard({ marker: false });
  const { Client } = require(path.join(API, "node_modules", "pg"));
  const client = new Client({ connectionString: databaseUrl });
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
    await client.query(
      "INSERT INTO analysis_guard.ownership VALUES ($1,$2)",
      [OWNER, run],
    );
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  } finally {
    await client.end();
  }
  process.env.PG_ANALYSIS_SYSTEM_ID = identity.server.system_identifier;
  await databaseGuard();

  execute(
    output,
    "migration-replay",
    process.execPath,
    [path.join(API, "node_modules", "prisma", "build", "index.js"), "migrate", "deploy"],
    {
      cwd: API,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      secrets,
    },
  );

  const verify = new Client({ connectionString: databaseUrl });
  await verify.connect();
  try {
    const migrations = (
      await verify.query(
        'SELECT migration_name, finished_at IS NOT NULL AS finished FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows;
    const expected = fs
      .readdirSync(path.join(API, "prisma", "migrations"), {
        withFileTypes: true,
      })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    assert.deepEqual(
      migrations.map(({ migration_name: name }) => name),
      expected,
    );
    assert.ok(migrations.every(({ finished }) => finished));
    receipt.postgresql = {
      version: identity.server.version,
      migrations: migrations.length,
      container: containerGuard(),
    };
  } finally {
    await verify.end();
  }
  return { id, databaseUrl };
}

async function main() {
  sourceGuard();
  assert.equal(
    git("status", "--porcelain"),
    "",
    "Exact-artifact validation requires a clean committed tip.",
  );
  const run = crypto.randomBytes(8).toString("hex");
  const output = path.join(
    ROOT,
    "test-results",
    "scim-artifact-current",
    `${BASE.slice(0, 12)}-${run}`,
  );
  assert.equal(fs.existsSync(output), false);
  fs.mkdirSync(output, { recursive: true });
  const secrets = [];
  const receipt = {
    status: "running",
    head: BASE,
    branch: git("branch", "--show-current"),
    apiTree: git("rev-parse", "HEAD:api"),
    run,
    output: path.relative(ROOT, output),
    startedAt: new Date().toISOString(),
    node: process.version,
  };
  let containerId;
  const save = () =>
    fs.writeFileSync(
      path.join(output, "receipt.json"),
      redact(JSON.stringify(receipt, null, 2), secrets),
    );
  try {
    const build = buildCommand();
    execute(output, "api-build", build.file, build.args, {
      cwd: API,
      secrets,
    });
    receipt.build = hashBuild();
    receipt.backends = [];
    receipt.backends.push(
      await runBuiltRuntime({
        backend: "inmemory",
        databaseUrl: INERT,
        output,
        secrets,
      }),
    );

    const password = crypto.randomBytes(36).toString("base64url");
    const postgres = await startPostgres({
      run,
      password,
      output,
      receipt,
      secrets,
      onContainer: (id) => {
        containerId = id;
        save();
      },
    });
    receipt.backends.push(
      await runBuiltRuntime({
        backend: "prisma",
        databaseUrl: postgres.databaseUrl,
        output,
        secrets,
      }),
    );
    receipt.status = "passed";
  } catch (error) {
    receipt.status = "failed";
    receipt.failure = redact(error.stack ?? error.message, secrets);
    process.exitCode = 1;
  } finally {
    const exactContainerId = containerId ?? receipt.container?.id;
    if (exactContainerId) {
      try {
        const container = JSON.parse(docker("inspect", exactContainerId))[0];
        assertOwnedContainerMetadata(container, {
          id: exactContainerId,
          run,
        });
        docker("rm", "-f", exactContainerId);
        assert.equal(
          docker("ps", "-aq", "--filter", `id=${exactContainerId}`),
          "",
        );
        receipt.cleanup = {
          exactContainerId,
          removed: true,
          persistentVolumesCreated: 0,
          customNetworksCreated: 0,
        };
      } catch (error) {
        receipt.cleanup = {
          exactContainerId,
          removed: false,
          failure: redact(error.message, secrets),
        };
        receipt.status = "failed";
        process.exitCode = 1;
      }
    }
    receipt.finishedAt = new Date().toISOString();
    save();
    console.log(
      JSON.stringify(
        {
          status: receipt.status,
          head: receipt.head,
          output: receipt.output,
          build: receipt.build,
          backends: receipt.backends?.map(({ backend, live, stopped }) => ({
            backend,
            live,
            stopped,
          })),
          postgresql: receipt.postgresql && {
            version: receipt.postgresql.version,
            migrations: receipt.postgresql.migrations,
          },
          cleanup: receipt.cleanup,
          failure: receipt.failure,
        },
        null,
        2,
      ),
    );
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  REQUIRED_LIVE_OUTCOMES,
  assertEmptyEndpointInventory,
  assertOwnedContainerMetadata,
  assertLiveReceipt,
  buildCommand,
  buildRuntimeEnv,
};
