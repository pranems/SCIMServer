const assert = require('node:assert/strict');
const path = require('node:path');
const { counterColumns, snapshotSql, validatePgSnapshot } = require('./membership-statements.cjs');
const { Client } = require(path.resolve(__dirname, '../../api/node_modules/pg'));

function client(options) {
  return new Client({ host: '127.0.0.1', database: 'postgres',
    connectionTimeoutMillis: 3000, query_timeout: 5000, ...options });
}

async function role(admin, name, password) {
  assert.ok(['statement_observer', 'statement_a', 'statement_b'].includes(name));
  await admin.query("SELECT set_config('scim_diag.role_password',$1,false)", [password]);
  await admin.query(`DO $body$ BEGIN EXECUTE format(
    'CREATE ROLE ${name} LOGIN PASSWORD %L',current_setting('scim_diag.role_password'));
    END $body$`);
}

async function initialize(admin, port, passwords) {
  await admin.query('CREATE EXTENSION pg_stat_statements');
  const capability = (await admin.query(`
    SELECT version() AS version,
      (SELECT extversion FROM pg_extension WHERE extname='pg_stat_statements') AS extension,
      encode(sha256(convert_to('diagnostic-capability','UTF8')),'hex') AS sha256,
      pg_postmaster_start_time() AS started,
      (SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN
        ('shared_preload_libraries','compute_query_id','pg_stat_statements.track',
        'pg_stat_statements.max','pg_stat_statements.track_utility',
        'pg_stat_statements.track_planning','track_io_timing','max_connections',
        'shared_buffers','work_mem','jit','fsync','synchronous_commit')) AS settings
  `)).rows[0];
  assert.match(capability.version, /^PostgreSQL 17\.11 /);
  assert.match(capability.sha256, /^[a-f0-9]{64}$/);
  assert.ok(capability.extension);
  assert.equal(capability.settings.compute_query_id, 'on');
  assert.equal(capability.settings['pg_stat_statements.track'], 'all');
  assert.ok(capability.settings.shared_preload_libraries.includes('pg_stat_statements'));
  const available = (await admin.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name='pg_stat_statements'`)).rows.map(row => row.column_name);
  for (const required of ['queryid', 'toplevel', 'calls', 'rows', 'total_exec_time'])
    assert.ok(available.includes(required), `Required PG statement field ${required}`);
  const columns = counterColumns.filter(column => available.includes(column));
  assert.equal(columns.length, counterColumns.length, 'Required PG17 block/temp/WAL counters');
  await role(admin, 'statement_observer', passwords.observer);
  await admin.query('GRANT pg_read_all_stats TO statement_observer');
  for (const name of ['a', 'b']) await role(admin, `statement_${name}`, passwords[name]);
  const observer = client({ port, user: 'statement_observer', password: passwords.observer,
    application_name: 'scim-statement-observer' });
  await observer.connect();
  return { capability, columns, observer };
}

async function createDatabase(admin, port, block, roleName) {
  assert.ok([0, 1].includes(block) && ['A', 'B'].includes(roleName));
  const role = `statement_${roleName.toLowerCase()}`;
  const database = `s${block}${roleName.toLowerCase()}`;
  await admin.query(`CREATE DATABASE ${database} OWNER ${role}`);
  const databaseClient = client({ port, user: admin.user, password: admin.password, database });
  try {
    await databaseClient.connect();
    await databaseClient.query('CREATE EXTENSION citext; CREATE EXTENSION pgcrypto; CREATE EXTENSION pg_trgm; CREATE EXTENSION "uuid-ossp"');
  } finally { await databaseClient.end(); }
  const ids = (await admin.query(`SELECT
    (SELECT oid::text FROM pg_database WHERE datname=$1) AS database_oid,
    (SELECT oid::text FROM pg_roles WHERE rolname=$2) AS user_oid`, [database, role])).rows[0];
  assert.match(ids.database_oid, /^\d+$/);
  assert.match(ids.user_oid, /^\d+$/);
  return { database, role, databaseOid: ids.database_oid, userOid: ids.user_oid };
}

async function captureStatements(observer, target, columns) {
  const started = process.hrtime.bigint();
  const startUtc = new Date().toISOString();
  const snapshot = (await observer.query(snapshotSql(columns),
    [target.databaseOid, target.userOid])).rows[0].snapshot;
  validatePgSnapshot(snapshot, columns);
  return { snapshot, hostRead: { startUtc, endUtc: new Date().toISOString(),
    elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 } };
}

module.exports = { client, initialize, createDatabase, captureStatements };
