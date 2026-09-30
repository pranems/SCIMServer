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
} = require("../scim-acceptance-current/current-safety.cjs");

assert.equal(process.argv.length, 2, "The performance runner accepts no arguments.");
sourceGuard();
const DATASET_SIZE = 50_000;
const TARGET = DATASET_SIZE - 1;
const run = crypto.randomBytes(8).toString("hex");
const password = crypto.randomBytes(36).toString("base64url");
const output = path.join(ROOT, "test-results", "scim-performance", run);
fs.mkdirSync(output, { recursive: true });
Object.assign(process.env, {
  PG_ANALYSIS_RUN: run,
  PG_ANALYSIS_OUTPUT: output,
});

const receipt = {
  head: BASE,
  run,
  owner: OWNER,
  startedAt: new Date().toISOString(),
  dataset: {
    resourceType: "Device",
    rows: DATASET_SIZE,
    targetDisplayName: `device-${String(TARGET).padStart(6, "0")}`,
    residualFilter: `cost ge ${DATASET_SIZE - 10}`,
    expectedResidualMatches: 10,
  },
  status: "starting",
  cleanup: {},
};
let containerId;
const clean = (value) =>
  String(value)
    .split(password)
    .join("[REDACTED]")
    .replace(
      /postgres(?:ql)?:\/\/[^@\s"']+@/gi,
      "postgresql://[REDACTED]@",
    );
const save = () =>
  fs.writeFileSync(
    path.join(output, "receipt.json"),
    `${JSON.stringify(receipt, null, 2)}\n`,
  );

function command(label, args, env = process.env) {
  const result = cp.spawnSync(process.execPath, args, {
    cwd: API,
    env,
    encoding: "utf8",
    maxBuffer: 100 * 1024 * 1024,
    windowsHide: true,
  });
  fs.writeFileSync(
    path.join(output, `${label}.log`),
    clean(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
  );
  if (result.error) throw result.error;
  return result.status;
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
};
const summary = (values) => ({
  samples: values.length,
  minMs: Math.min(...values),
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
  maxMs: Math.max(...values),
});
const elapsedMs = (started) => Number(process.hrtime.bigint() - started) / 1e6;

function planSummary(planDocument) {
  const root = planDocument[0]["QUERY PLAN"][0];
  const nodes = [];
  let sharedHitBlocks = 0;
  let sharedReadBlocks = 0;
  const visit = (node) => {
    nodes.push(node["Node Type"]);
    sharedHitBlocks += node["Shared Hit Blocks"] ?? 0;
    sharedReadBlocks += node["Shared Read Blocks"] ?? 0;
    for (const child of node.Plans ?? []) visit(child);
  };
  visit(root.Plan);
  return {
    planningTimeMs: root["Planning Time"],
    executionTimeMs: root["Execution Time"],
    actualRows: root.Plan["Actual Rows"],
    nodes,
    sharedHitBlocks,
    sharedReadBlocks,
  };
}

async function measureAsync(operation, samples = 9, warmups = 2) {
  for (let i = 0; i < warmups; i++) await operation();
  const times = [];
  let value;
  for (let i = 0; i < samples; i++) {
    const started = process.hrtime.bigint();
    value = await operation();
    times.push(elapsedMs(started));
  }
  return { value, latency: summary(times) };
}

function measureSync(operation, samples = 15, warmups = 3) {
  for (let i = 0; i < warmups; i++) operation();
  const times = [];
  let value;
  for (let i = 0; i < samples; i++) {
    const started = process.hrtime.bigint();
    value = operation();
    times.push(elapsedMs(started));
  }
  return { value, latency: summary(times) };
}

async function main() {
  receipt.dockerServerVersion = docker(
    "version",
    "--format",
    "{{.Server.Version}}",
  );
  receipt.image = "postgres:17-alpine";
  receipt.imageId = docker(
    "image",
    "inspect",
    receipt.image,
    "--format",
    "{{.Id}}",
  );
  containerId = cp
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
  const inspected = JSON.parse(docker("inspect", containerId))[0];
  const port = inspected.NetworkSettings.Ports["5432/tcp"][0].HostPort;
  process.env.DATABASE_URL =
    `postgresql://fresh_runner:${password}@127.0.0.1:${port}/scim_fresh_${run}`;
  receipt.container = containerGuard();
  save();

  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = cp.spawnSync(
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
    ).status;
    if (status === 0) {
      ready = true;
      break;
    }
    assert.ok([1, 2].includes(status));
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(ready, "Disposable PostgreSQL did not become ready.");
  receipt.beforeMigration = await databaseGuard({ marker: false });
  process.env.PG_ANALYSIS_SYSTEM_ID =
    receipt.beforeMigration.server.system_identifier;

  const { Client } = require(path.join(API, "node_modules", "pg"));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public'",
        )
      ).rows[0].n,
      0,
    );
    await client.query("CREATE SCHEMA analysis_guard");
    await client.query(
      "CREATE TABLE analysis_guard.ownership(owner text NOT NULL, run text NOT NULL)",
    );
    await client.query(
      "INSERT INTO analysis_guard.ownership VALUES ($1, $2)",
      [OWNER, run],
    );
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await databaseGuard();
    assert.equal(
      command("migration-replay", [
        path.join(API, "node_modules", "prisma", "build", "index.js"),
        "migrate",
        "deploy",
      ]),
      0,
    );
    receipt.migrations = (
      await client.query(
        'SELECT migration_name FROM "_prisma_migrations" ORDER BY migration_name',
      )
    ).rows.map((row) => row.migration_name);
    assert.equal(receipt.migrations.length, 22);

    const endpointId = crypto.randomUUID();
    await client.query(
      `INSERT INTO "Endpoint"
        (id, name, active, "createdAt", "updatedAt")
       VALUES ($1::uuid, $2, true, now(), now())`,
      [endpointId, `performance-${run}`],
    );
    const seedStarted = process.hrtime.bigint();
    await client.query(
      `INSERT INTO "ScimResource"
        ("endpointId", "resourceType", "scimId", "displayName", active,
         payload, version, meta, "createdAt", "updatedAt")
       SELECT $1::uuid, 'Device', gen_random_uuid(),
         'device-' || lpad(series::text, 6, '0'), true,
         jsonb_build_object(
           'cost', series,
           'entries', jsonb_build_array(jsonb_build_object('rank', series))
         ),
         1, '{}',
         clock_timestamp() + series * interval '1 microsecond',
         clock_timestamp() + series * interval '1 microsecond'
       FROM generate_series(0, $2::int - 1) AS series`,
      [endpointId, DATASET_SIZE],
    );
    await client.query('ANALYZE "ScimResource"');
    receipt.seed = {
      rows: Number(
        (
          await client.query(
            'SELECT count(*)::int AS n FROM "ScimResource" WHERE "endpointId"=$1::uuid',
            [endpointId],
          )
        ).rows[0].n,
      ),
      elapsedMs: elapsedMs(seedStarted),
    };
    assert.equal(receipt.seed.rows, DATASET_SIZE);

    const targetName = receipt.dataset.targetDisplayName;
    const exactSql = `SELECT * FROM "ScimResource"
      WHERE "endpointId"=$1::uuid AND "resourceType"='Device'
        AND "displayName"=$2::citext ORDER BY "createdAt" ASC`;
    const fullSql = `SELECT * FROM "ScimResource"
      WHERE "endpointId"=$1::uuid AND "resourceType"='Device'
      ORDER BY "createdAt" ASC`;
    receipt.postgresql = {
      exactPlan: planSummary(
        (
          await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${exactSql}`,
            [endpointId, targetName],
          )
        ).rows,
      ),
      residualFetchPlan: planSummary(
        (
          await client.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${fullSql}`,
            [endpointId],
          )
        ).rows,
      ),
    };
    const exact = await measureAsync(
      () => client.query(exactSql, [endpointId, targetName]),
      9,
    );
    const full = await measureAsync(
      () => client.query(fullSql, [endpointId]),
      9,
    );
    assert.equal(exact.value.rows.length, 1);
    assert.equal(full.value.rows.length, DATASET_SIZE);
    receipt.postgresql.exactFetch = {
      rowsTransferred: exact.value.rows.length,
      latency: exact.latency,
    };
    receipt.postgresql.residualFetch = {
      rowsTransferred: full.value.rows.length,
      serializedBytes: Buffer.byteLength(JSON.stringify(full.value.rows)),
      latency: full.latency,
    };

    const {
      createReadQuery,
    } = require(path.join(
      API,
      "dist",
      "modules",
      "scim",
      "common",
      "scim-read-query.js",
    ));
    const {
      buildGenericFilter,
    } = require(path.join(
      API,
      "dist",
      "modules",
      "scim",
      "filters",
      "apply-scim-filter.js",
    ));
    const schema = [
      {
        id: "urn:example:performance:Device",
        isCoreSchema: true,
        attributes: [
          {
            name: "displayName",
            type: "string",
            multiValued: false,
            caseExact: false,
          },
          { name: "cost", type: "integer", multiValued: false },
          {
            name: "entries",
            type: "complex",
            multiValued: true,
            subAttributes: [
              { name: "rank", type: "integer", multiValued: false },
            ],
          },
        ],
      },
    ];
    const toInternal = (row) => ({
      id: row.scimId,
      displayName: row.displayName,
      ...row.payload,
    });
    const project = (row) => ({
      id: row.scimId,
      displayName: row.displayName,
    });
    const exactQuery = createReadQuery(
      { filter: `displayName eq "${targetName}"`, count: 5 },
      schema,
      200,
      buildGenericFilter,
    );
    const residualQuery = createReadQuery(
      { filter: receipt.dataset.residualFilter, count: 5 },
      schema,
      200,
      buildGenericFilter,
    );
    assert.notDeepEqual(exactQuery.dbWhere, {});
    assert.deepEqual(residualQuery.dbWhere, {});

    const exactRows = exact.value.rows;
    const fullRows = full.value.rows;
    let exactInternalCalls = 0;
    let residualInternalCalls = 0;
    const exactPage = measureSync(() =>
      exactQuery.page(
        exactRows,
        (row) => {
          exactInternalCalls++;
          return toInternal(row);
        },
        project,
      ),
    );
    const exactCallsPerSample =
      exactInternalCalls / (exactPage.latency.samples + 3);
    const residualRssBefore = process.resourceUsage().maxRSS;
    const residualPage = measureSync(() =>
      residualQuery.page(
        fullRows,
        (row) => {
          residualInternalCalls++;
          return toInternal(row);
        },
        project,
      ),
    );
    const residualCallsPerSample =
      residualInternalCalls / (residualPage.latency.samples + 3);
    const residualRssAfter = process.resourceUsage().maxRSS;
    assert.equal(exactCallsPerSample, 1);
    assert.equal(residualCallsPerSample, DATASET_SIZE);
    assert.equal(residualPage.value.totalResults, 10);
    assert.equal(residualPage.value.Resources.length, 5);
    receipt.service = {
      exactPushdown: {
        candidateRows: exactCallsPerSample,
        totalResults: exactPage.value.totalResults,
        returned: exactPage.value.Resources.length,
        latency: exactPage.latency,
      },
      residualNumeric: {
        candidateRows: residualCallsPerSample,
        totalResults: residualPage.value.totalResults,
        returned: residualPage.value.Resources.length,
        selectivity: residualPage.value.totalResults / DATASET_SIZE,
        latency: residualPage.latency,
        maxRssBeforeKiB: residualRssBefore,
        maxRssAfterKiB: residualRssAfter,
      },
      materializationRatio:
        residualCallsPerSample / exactCallsPerSample,
    };
    receipt.assessment = {
      outcome:
        "Residual filtering is correct but its service and transfer cost scales with endpoint candidate cardinality rather than page size.",
      boundedAtRows: DATASET_SIZE,
      optimizationDecision:
        "No production optimization is included in correctness consolidation. A future change may push schema-resolved JSONB predicates while preserving full-result counting and filter semantics.",
    };
    receipt.status = "complete";
  } finally {
    await client.end();
  }
}

main()
  .catch((error) => {
    receipt.status = "failed";
    receipt.failure = clean(error.stack ?? error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    if (containerId) {
      try {
        const container = JSON.parse(docker("inspect", containerId))[0];
        assert.equal(container.Id, containerId);
        assert.equal(container.Config.Labels["scim.analysis.owner"], OWNER);
        assert.equal(container.Config.Labels["scim.analysis.run"], run);
        docker("rm", "--force", containerId);
        assert.equal(
          docker(
            "ps",
            "--all",
            "--quiet",
            "--no-trunc",
            "--filter",
            `id=${containerId}`,
          ),
          "",
        );
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
          output: path.relative(ROOT, output),
          dataset: receipt.dataset,
          postgres: receipt.postgresql,
          service: receipt.service,
          cleanup: receipt.cleanup,
          failure: receipt.failure,
        },
        null,
        2,
      ),
    );
  });
