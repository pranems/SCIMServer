const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

async function runPatchSchema(baseUrl, token) {
  assert.ok(token);
  assert.ok(['http:', 'https:'].includes(new URL(baseUrl).protocol));
  let assertions = 0;
  const cases = [];
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  async function http(method, route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/scim+json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    return { status: response.status, etag: response.headers.get('etag'), body: text ? JSON.parse(text) : undefined };
  }
  const inventory = (await http('GET', '/scim/admin/endpoints')).body;
  const extension = 'urn:example:extension:live-p7b:2.0';
  const optional = 'urn:example:optional:live-p7b:2.0';
  const patch = Operations => ({ schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'], Operations });
  for (const family of ['User', 'Group', 'Widget']) for (const strict of [true, false]) {
    const core = family === 'Widget' ? 'urn:example:core:live:Widget' : `urn:ietf:params:scim:schemas:core:2.0:${family}`;
    const primary = family === 'User' ? 'userName' : family === 'Group' ? 'displayName' : 'label';
    const attributes = [
      { name: 'count', type: 'integer' },
      { name: 'asked', type: 'string', returned: 'request' },
      { name: 'hidden', type: 'string', returned: 'never' },
      { name: 'secret', type: 'string', mutability: 'writeOnly' },
      { name: 'locked', type: 'string', mutability: 'readOnly' },
      { name: 'tags', type: 'string', multiValued: true },
      { name: 'record', type: 'complex', subAttributes: [
        { name: 'key', type: 'string', required: true, mutability: 'immutable' },
        { name: 'note', type: 'string', returned: 'request' },
      ] },
    ];
    const endpoint = await http('POST', '/scim/admin/endpoints', { name: `live-p7b-${randomUUID()}`, profile: {
      schemas: [
        { id: core, name: family, attributes: [
          { name: primary, type: 'string', required: true }, { name: 'marker', type: 'string' }, ...attributes,
          ...(family === 'Widget' ? [{ name: 'displayName', type: 'integer', multiValued: true },
            { name: 'active', type: 'string' }] : []),
        ] },
        { id: extension, name: 'P7bExtension', attributes: [
          { name: 'externalId', type: 'integer', multiValued: true }, ...attributes,
        ] },
        { id: optional, name: 'P7bOptional', attributes },
      ],
      resourceTypes: [{ id: family, name: family, endpoint: `/${family}s`, schema: core,
        schemaExtensions: [{ schema: extension, required: true }, { schema: optional, required: false }] }],
      settings: { StrictSchemaValidation: strict, VerbosePatchSupported: true,
        IgnoreReadOnlyAttributesInPatch: true, logFileEnabled: false },
      serviceProviderConfig: { patch: { supported: true }, etag: { supported: true } },
    } });
    eq(endpoint.status, 201);
    const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
    const route = `/scim/endpoints/${endpoint.body.id}/${family}s`;
    try {
      const created = await http('POST', route, { schemas: [core, extension, optional], [primary]: randomUUID(),
        externalId: 'OriginalCase', marker: 'before', asked: 'unsupplied', hidden: 'private', secret: 'private',
        [extension]: { count: 1, externalId: [1], asked: 'before', record: { key: 'fixed' } },
        [optional]: { count: 1 },
        ...(family === 'Widget' ? { displayName: [1, 2], active: 'custom' } : {}),
      });
      eq(created.status, 201);
      const url = `${route}/${created.body.id}`;
      for (const op of ['add', 'replace']) for (const pathless of [false, true]) {
        const value = { count: 2, locked: 7, asked: 'supplied', record: { note: 'partial' }, tags: op === 'add' ? 'new' : ['new'] };
        const result = await http('PATCH', url, patch([pathless ? { op, value: { [extension]: value } }
          : { op, path: op === 'replace' ? extension.toUpperCase() : extension, value }]));
        eq(result.status, 200);
        eq(result.body[extension].count, 2);
        eq(result.body[extension].locked, undefined);
        eq(result.body[extension].asked, 'supplied');
        eq(result.body[extension].record, { key: 'fixed', note: 'partial' });
        eq(result.body.asked, undefined);
        eq(result.body.hidden, undefined);
        eq(result.body.secret, undefined);
        eq((await http('GET', url)).body[extension].asked, undefined);
        cases.push({ family, strict, op, pathless, acceptedNamespace: true });
      }
      const removed = await http('PATCH', url, patch([
        { op: 'replace', path: 'marker', value: 'committed-with-success' },
        { op: 'replace', path: optional, value: null },
      ]));
      eq(removed.status, 200);
      eq(removed.body.marker, 'committed-with-success');
      eq(removed.body[optional], undefined);
      eq((await http('GET', url)).body, removed.body);
      cases.push({ family, strict, optionalNumericNamespaceRemoval: true });
      if (!strict) {
        const ignored = await http('PATCH', url, patch([
          { op: 'replace', value: { marker: 'ignored-key-success', prototype: 'ignored' } },
        ]));
        eq(ignored.status, 200);
        eq(ignored.body.marker, 'ignored-key-success');
        eq(Object.hasOwn(ignored.body, 'prototype'), false);
        eq((await http('GET', url)).body, ignored.body);
        cases.push({ family, strict, ignoredNoPathKey: true });
      }
      const rejected = [
        { op: 'remove', path: extension },
        { op: 'replace', value: { [extension]: null } },
        { op: 'replace', path: extension, value: { record: { key: 'changed' } } },
        ...[42, false, [], { value: 'invalid' }].flatMap(value => [
          { op: 'replace', path: 'externalId', value },
          { op: 'replace', path: `${core}:externalId`, value },
          { op: 'replace', value: { externalId: value } },
        ]),
        ...(strict ? [[], 42, { count: 'bad' }, { unexpected: true },
          { record: { key: 'fixed', unexpected: true } }].flatMap(value => [
          { op: 'replace', path: extension, value },
          { op: 'replace', value: { [extension]: value } },
        ]) : []),
      ];
      for (const operation of rejected) {
        const before = await http('GET', url);
        const result = await http('PATCH', url, patch([{ op: 'replace', path: 'marker', value: 'rollback' }, operation]));
        eq(result.status, 400);
        eq(result.body.status, '400');
        eq(result.body['urn:scimserver:api:messages:2.0:Diagnostics'].failedOperationIndex, 1);
        eq(Object.keys(result.body).every(k => ['schemas', 'status', 'scimType', 'detail',
          'urn:scimserver:api:messages:2.0:Diagnostics'].includes(k)), true);
        eq(await http('GET', url), before);
        cases.push({ family, strict, rejected: operation });
      }
      const custom = await http('PATCH', url, patch([
        { op: 'replace', path: `${core}:externalId`, value: 'NewCase' },
        { op: 'replace', path: `${extension}:externalId`, value: [7, 8] },
        ...(family === 'Widget' ? [{ op: 'replace', path: 'displayName', value: [11, 12] },
          { op: 'replace', path: 'active', value: 'next-custom' }] : []),
      ]));
      eq(custom.status, 200);
      eq(custom.body.externalId, 'NewCase');
      eq(custom.body[extension].externalId, [7, 8]);
      if (family === 'Widget') { eq(custom.body.displayName, [11, 12]); eq(custom.body.active, 'next-custom'); }
      eq((await http('GET', url)).body, custom.body);
    } finally {
      eq((await http('DELETE', admin)).status, 204);
      eq((await http('GET', admin)).status, 404);
    }
  }
  eq((await http('GET', '/scim/admin/endpoints')).body, inventory);
  return { cases: cases.length, assertions, outcomes: cases, endpointCollectionUnchanged: true };
}

module.exports = { runPatchSchema };
