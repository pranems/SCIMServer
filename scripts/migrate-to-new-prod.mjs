#!/usr/bin/env node
/**
 * Migrate keeper endpoints from OLD prod (scimserver2) to NEW prod PG, PRESERVING IDs.
 *
 * Strategy: SCIM API on source (data plane only - no Azure RBAC needed) returns
 * id+payload for endpoints/users/groups, we craft INSERT SQL that explicitly
 * sets the id columns. ScimResource.id stays the same; ResourceMember rows are
 * re-derived from the user/group ids.
 *
 * Filters OUT live-test-* / live-9z-* names per pipeline-prompt request.
 *
 * Usage (must have `pg` installed; we use `psql` via docker so no node deps):
 *   node scripts/migrate-to-new-prod.mjs \
 *     --source https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io \
 *     --source-secret changeme-oauth \
 *     --target-pg-host scimserver-prod-pg.postgres.database.azure.com \
 *     --target-pg-db scimdb \
 *     --target-pg-user scimadmin \
 *     --out-sql ./migration.sql
 *
 * Then apply:
 *   docker run --rm -e PGPASSWORD=... -v ${PWD}:/work postgres:17-alpine \
 *     psql -h <host> -U scimadmin -d scimdb -f /work/migration.sql -v ON_ERROR_STOP=1
 */

import { writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

function parseArgs() {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

const args = parseArgs();
const SOURCE = (args.source || 'https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io').replace(/\/$/, '');
const SOURCE_CLIENT_ID = args['source-client-id'] || 'scimserver-client';
const SOURCE_CLIENT_SECRET = args['source-secret'] || 'changeme-oauth';
const OUT_SQL = args['out-sql'] || './migration.sql';
const KEEP_FILTER = /-ISV(-\d+)?$/i; // keep "*-ISV", "*-ISV-1", "*-ISV-2", etc.; drop "live-test-*"

async function getToken() {
  const r = await fetch(`${SOURCE}/scim/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: SOURCE_CLIENT_ID, client_secret: SOURCE_CLIENT_SECRET }),
  });
  if (!r.ok) throw new Error(`token: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.access_token;
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: 'application/scim+json' } });
  if (!r.ok) throw new Error(`GET ${url}: ${r.status} ${await r.text()}`);
  return r.json();
}

/** SQL string escape - doubles single quotes. */
function sql(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** SQL JSONB literal */
function jsonb(v) {
  if (v === null || v === undefined) return 'NULL';
  return `${sql(JSON.stringify(v))}::jsonb`;
}

/** UUID cast */
function uuid(v) {
  if (!v) return 'NULL';
  return `${sql(v)}::uuid`;
}

async function fetchAll(url, token) {
  // Paginated SCIM ListResponse: itemsPerPage=100, startIndex 1..N
  const out = [];
  let start = 1;
  const pageSize = 100;
  while (true) {
    const sep = url.includes('?') ? '&' : '?';
    const page = await getJson(`${url}${sep}startIndex=${start}&count=${pageSize}`, token);
    const items = page.Resources || page.resources || [];
    out.push(...items);
    if (items.length < pageSize) break;
    start += pageSize;
    if (start > 100000) throw new Error(`runaway pagination at ${url}`);
  }
  return out;
}

async function main() {
  console.error(`[migrate] source = ${SOURCE}`);
  const token = await getToken();
  console.error(`[migrate] got source OAuth token`);

  // 1. All endpoints (admin list returns id+name; we need full bodies)
  const listResp = await getJson(`${SOURCE}/scim/admin/endpoints?view=full&count=200`, token);
  const allEndpoints = listResp.endpoints || listResp.Resources || [];
  console.error(`[migrate] source has ${allEndpoints.length} endpoints total`);

  const keepers = allEndpoints.filter((e) => KEEP_FILTER.test(e.name || ''));
  const dropped = allEndpoints.filter((e) => !KEEP_FILTER.test(e.name || ''));
  console.error(`[migrate] keepers: ${keepers.length} | dropped (live-test cruft): ${dropped.length}`);
  console.error(`[migrate] dropped names: ${dropped.map((e) => e.name).join(', ')}`);

  const sqlLines = [];
  sqlLines.push('-- Migration: scimserver2 (old prod) -> scimserver-prod (new prod)');
  sqlLines.push(`-- Generated: ${new Date().toISOString()}`);
  sqlLines.push(`-- Source: ${SOURCE}`);
  sqlLines.push(`-- Endpoints kept: ${keepers.length}`);
  sqlLines.push('BEGIN;');
  sqlLines.push('');

  let totalUsers = 0;
  let totalGroups = 0;
  let totalMembers = 0;

  for (const ep of keepers) {
    console.error(`[migrate] endpoint ${ep.name} (${ep.id})`);
    sqlLines.push(`-- ===== Endpoint: ${ep.name} (${ep.id}) =====`);
    // Insert endpoint with explicit id; profile blob comes from ep.profile
    sqlLines.push(
      `INSERT INTO "Endpoint" ("id","name","displayName","description","profile","active","createdAt","updatedAt") VALUES (${uuid(ep.id)}, ${sql(ep.name)}, ${sql(ep.displayName || null)}, ${sql(ep.description || null)}, ${jsonb(ep.profile || null)}, ${ep.active !== false ? 'TRUE' : 'FALSE'}, NOW(), NOW()) ON CONFLICT (id) DO NOTHING;`,
    );

    // Users for this endpoint
    let users = [];
    try {
      users = await fetchAll(`${SOURCE}/scim/v2/endpoints/${ep.id}/Users`, token);
    } catch (e) {
      console.error(`  ! failed fetching users for ${ep.name}: ${e.message}`);
    }
    console.error(`  users: ${users.length}`);
    for (const u of users) {
      // ScimResource row. Polymorphic table - resourceType='User'.
      sqlLines.push(
        `INSERT INTO "ScimResource" ("id","endpointId","resourceType","scimId","externalId","userName","displayName","active","payload","version","meta","createdAt","updatedAt") VALUES (${uuid(u.id)}, ${uuid(ep.id)}, 'User', ${uuid(u.id)}, ${sql(u.externalId || null)}, ${sql(u.userName || null)}, ${sql(u.displayName || u.name?.formatted || null)}, ${u.active !== false ? 'TRUE' : 'FALSE'}, ${jsonb(u)}, ${u.meta?.version ? Number(u.meta.version) || 1 : 1}, NULL, ${sql(u.meta?.created || null)}::timestamptz, ${sql(u.meta?.lastModified || null)}::timestamptz) ON CONFLICT (id) DO NOTHING;`,
      );
      totalUsers++;
    }

    // Groups for this endpoint
    let groups = [];
    try {
      groups = await fetchAll(`${SOURCE}/scim/v2/endpoints/${ep.id}/Groups`, token);
    } catch (e) {
      console.error(`  ! failed fetching groups for ${ep.name}: ${e.message}`);
    }
    console.error(`  groups: ${groups.length}`);
    for (const g of groups) {
      sqlLines.push(
        `INSERT INTO "ScimResource" ("id","endpointId","resourceType","scimId","externalId","userName","displayName","active","payload","version","meta","createdAt","updatedAt") VALUES (${uuid(g.id)}, ${uuid(ep.id)}, 'Group', ${uuid(g.id)}, ${sql(g.externalId || null)}, NULL, ${sql(g.displayName || null)}, TRUE, ${jsonb(g)}, ${g.meta?.version ? Number(g.meta.version) || 1 : 1}, NULL, ${sql(g.meta?.created || null)}::timestamptz, ${sql(g.meta?.lastModified || null)}::timestamptz) ON CONFLICT (id) DO NOTHING;`,
      );
      totalGroups++;

      // Members - the `value` is a user uuid, we link to the ScimResource row we just inserted
      const members = Array.isArray(g.members) ? g.members : [];
      for (const m of members) {
        const memberValue = m.value || null;
        if (!memberValue) continue;
        sqlLines.push(
          `INSERT INTO "ResourceMember" ("id","groupResourceId","memberResourceId","value","type","display","createdAt") VALUES (gen_random_uuid(), ${uuid(g.id)}, (SELECT id FROM "ScimResource" WHERE "endpointId"=${uuid(ep.id)} AND "scimId"=${uuid(memberValue)}), ${sql(memberValue)}, ${sql(m.type || 'User')}, ${sql(m.display || null)}, NOW()) ON CONFLICT ("groupResourceId","value") DO NOTHING;`,
        );
        totalMembers++;
      }
    }
    sqlLines.push('');
  }

  sqlLines.push('COMMIT;');
  sqlLines.push('');
  sqlLines.push(`-- Totals: ${keepers.length} endpoints, ${totalUsers} users, ${totalGroups} groups, ${totalMembers} member edges`);

  writeFileSync(OUT_SQL, sqlLines.join('\n'));
  console.error(`[migrate] wrote ${OUT_SQL}`);
  console.error(`[migrate] totals: endpoints=${keepers.length} users=${totalUsers} groups=${totalGroups} members=${totalMembers}`);
}

main().catch((err) => {
  console.error(`[migrate] FATAL: ${err.stack || err.message}`);
  exit(1);
});
