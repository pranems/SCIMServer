const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');

async function runCommonExternalIdPatch(baseUrl, token) {
  assert.ok(['http:', 'https:'].includes(new URL(baseUrl).protocol));
  assert.ok(token);
  const api = path.resolve(__dirname, '..', '..', 'api');
  const fixturePath = path.join(api, 'test', 'helpers', 'common-externalid-patch.fixture.ts');
  const ts = require(path.join(api, 'node_modules', 'typescript'));
  const loaded = new Module(fixturePath, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(fixturePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, fixturePath);
  const { commonExternalIdPatchFixture, invalidCommonExternalIds, COMMON_PATCH_EXTENSION: extension } = loaded.exports;
  const patchUrn = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
  const outcomes = [];
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  async function http(method, route, body) {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    return { status: response.status, etag: response.headers.get('etag'), body: text ? JSON.parse(text) : undefined };
  }
  for (const family of ['User', 'Group', 'Widget']) {
    for (const strict of [true, false]) {
      const fixture = commonExternalIdPatchFixture(family, strict);
      const endpoint = await http('POST', '/scim/admin/endpoints', {
        name: `live-common-patch-${randomUUID()}`, profile: fixture.profile,
      });
      eq(endpoint.status, 201);
      const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
      const base = `/scim/endpoints/${endpoint.body.id}/${family}s`;
      try {
        for (const pathless of [false, true]) {
          for (const value of invalidCommonExternalIds) {
            const created = await http('POST', base, fixture.payload(`resource-${randomUUID()}`));
            eq(created.status, 201);
            const url = `${base}/${created.body.id}`;
            const before = await http('GET', url);
            eq(before.status, 200);
            const response = await http('PATCH', url, { schemas: [patchUrn], Operations: [
              { op: 'replace', path: 'marker', value: 'must-rollback' },
              pathless ? { op: 'replace', value: { externalId: value } }
                : { op: 'replace', path: 'externalId', value },
            ] });
            eq(response.status, 400);
            eq(response.body.status, '400');
            eq(['invalidValue', 'invalidSyntax'].includes(response.body.scimType), true);
            eq(typeof response.body.detail, 'string');
            eq(response.body.schemas[0], 'urn:ietf:params:scim:api:messages:2.0:Error');
            eq(Object.keys(response.body).every(key =>
              ['schemas', 'status', 'scimType', 'detail', 'urn:scimserver:api:messages:2.0:Diagnostics'].includes(key)), true);
            const after = await http('GET', url);
            eq(after.status, 200);
            eq(after.body, before.body);
            eq(after.etag, before.etag);
            outcomes.push({ family, strict, pathless, rejected: value });
          }
        }
        const created = await http('POST', base, fixture.payload(`resource-${randomUUID()}`));
        eq(created.status, 201);
        const url = `${base}/${created.body.id}`;
        const changed = await http('PATCH', url, { schemas: [patchUrn], Operations: [
          { op: 'replace', path: 'EXTERNALID', value: 'NewCase' },
          { op: 'replace', path: `${extension}:externalId`, value: [2, 3] },
        ] });
        eq(changed.status, 200);
        eq(changed.body.externalId, 'NewCase');
        eq(changed.body[extension].externalId, [2, 3]);
        if (family === 'Widget') {
          eq(changed.body.displayName, [7, 8]);
          eq(changed.body.active, 'custom');
        }
        const read = await http('GET', url);
        eq(read.status, 200);
        eq(read.body, changed.body);
        outcomes.push({ family, strict, commonStringAndExtensionAndCustomControls: true });
      } finally {
        eq((await http('DELETE', admin)).status, 204);
        eq((await http('GET', admin)).status, 404);
      }
    }
  }
  return { cases: outcomes.length, assertions, outcomes };
}

module.exports = { runCommonExternalIdPatch };
if (require.main === module) {
  runCommonExternalIdPatch(process.env.SCIM_LIVE_BASE_URL, process.env.SCIM_LIVE_TOKEN)
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
