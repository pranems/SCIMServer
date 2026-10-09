const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { liveFetch } = require('../live-test-http.cjs');

async function runRetainedEntryPut(baseUrl, token) {
  assert.ok(['http:', 'https:'].includes(new URL(baseUrl).protocol));
  assert.ok(token);
  const api = path.resolve(__dirname, '..', '..', 'api');
  const fixture = path.join(api, 'test', 'helpers', 'retained-entry.fixture.ts');
  const ts = require(path.join(api, 'node_modules', 'typescript'));
  const loaded = new Module(fixture, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(fixture, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, fixture);
  const { retainedEntryCases, retainedRecordsAttribute } = loaded.exports;
  const extension = 'urn:example:extension:2.0:Retained';
  let assertions = 0;
  const outcomes = [];
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  async function http(method, route, body) {
    const response = await liveFetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  }
  for (const family of ['User', 'Group', 'Widget']) {
    const core = family === 'Widget' ? 'urn:example:core:2.0:Widget' : `urn:ietf:params:scim:schemas:core:2.0:${family}`;
    const primary = family === 'User' ? 'userName' : 'displayName';
    for (const strict of [true, false]) {
      for (const mutability of ['readOnly', 'immutable']) {
        for (const scenario of retainedEntryCases) {
          const profile = {
            schemas: [
              { id: core, name: family, attributes: [
                { name: primary, type: 'string', required: true }, { name: 'active', type: 'boolean' },
                ...(family === 'Group' ? [{ name: 'members', type: 'complex', multiValued: true,
                  subAttributes: [{ name: 'value', type: 'string' }] }] : []),
                retainedRecordsAttribute('readWrite'),
              ] },
              { id: extension, name: 'RetainedExtension', attributes: [retainedRecordsAttribute('readWrite')] },
            ],
            resourceTypes: [{ id: family, name: family, endpoint: `/${family}s`, schema: core,
              schemaExtensions: [{ schema: extension, required: false }] }],
            settings: { StrictSchemaValidation: strict, logFileEnabled: false },
            serviceProviderConfig: { etag: { supported: true } },
          };
          const endpoint = await http('POST', '/scim/admin/endpoints', { name: `live-retained-${randomUUID()}`, profile });
          eq(endpoint.status, 201);
          const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
          try {
            const base = `/scim/endpoints/${endpoint.body.id}/${family}s`;
            const name = `retained-${randomUUID()}`;
            const created = await http('POST', base, { schemas: [core, extension], [primary]: name,
              records: scenario.before, [extension]: { records: scenario.before } });
            eq(created.status, 201);
            const updatedProfile = structuredClone(profile);
            for (const schema of updatedProfile.schemas) {
              schema.attributes = schema.attributes.map(attribute => attribute.name === 'records'
                ? retainedRecordsAttribute(mutability) : attribute);
            }
            eq((await http('PATCH', admin, { profile: updatedProfile })).status, 200);
            const url = `${base}/${created.body.id}`;
            for (const version of [2, 3]) {
              const replaced = await http('PUT', url, { schemas: [core, extension], [primary]: name,
                records: scenario.after, [extension]: { records: scenario.after } });
              eq(replaced.status, 200);
              eq(replaced.body.id, created.body.id);
              eq(replaced.body.records, scenario.expected);
              eq(replaced.body[extension].records, scenario.expected);
              eq(replaced.body.meta.version, `W/"v${version}"`);
              const read = await http('GET', url);
              eq(read.status, 200);
              eq(read.body, replaced.body);
              eq(Object.keys(read.body).every(key =>
                ['schemas', 'id', 'meta', primary, 'active', 'members', 'records', extension].includes(key)), true);
            }
            outcomes.push({ family, strict, mutability, scenario: scenario.name });
          } finally {
            eq((await http('DELETE', admin)).status, 204);
            eq((await http('GET', admin)).status, 404);
          }
        }
      }
    }
  }
  return { cases: outcomes.length, assertions, outcomes };
}

module.exports = { runRetainedEntryPut };
if (require.main === module) {
  runRetainedEntryPut(process.env.SCIM_LIVE_BASE_URL, process.env.SCIM_LIVE_TOKEN)
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
