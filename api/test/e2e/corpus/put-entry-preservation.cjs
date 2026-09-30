const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const EXT = "urn:example:params:scim:schemas:extension:put-entries:2.0:Test";
const DIAG = "urn:scimserver:api:messages:2.0:Diagnostics";
const cases = ["User", "Group", "Widget"].flatMap(resource =>
  [false, true].map(strict => ({ resource, strict, title: `${resource} strict=${strict}` })));
const same = type => ({ value: "same", ...(type === undefined ? {} : { type }) });
const vectors = [
  { name: "typed reorder", before: [same("work"), same("home")], after: [same("home"), same("work")], old: [1, 0] },
  { name: "equal occurrence plus addition", before: [same("work"), same("work")],
    after: [same("work"), same("work"), same("work")], old: [0, 1, null] },
  { name: "anonymous versus identified", before: [same(), {}, {}], after: [{}, same(), {}, {}], old: [1, 0, 2, null] },
  { name: "null versus absent", before: [{}, { value: null }], after: [{ value: null }, {}], old: [1, 0] },
  { name: "omitted type before exact", before: [same("work"), same("home")], after: [same(), same("work")], old: [1, 0] },
  { name: "changed type before exact", before: [same("work"), same("home")], after: [same("other"), same("work")], old: [1, 0] },
  { name: "ambiguous omitted types", before: [same("work"), same("home")], after: [same(), same()], old: [0, 1] },
  { name: "restored immutable type", before: [same("work"), same("work")], after: [same(), same("work")], old: [0, 1], immutableType: true },
  { name: "unassigned immutable type", before: [{ ...same(), type: null }, same(), { ...same(), type: null }],
    after: [same("work"), same(), same()], old: [0, 1, 2], immutableType: true },
  { name: "remove and add", before: [{ value: "removed" }, same("work")], after: [{ value: "added" }, same("work")], old: [null, 1] },
  { name: "remove all", before: [same("work")], after: [], old: [] },
];

async function runCase(test, send) {
  let assertions = 0;
  const wire = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const eq = (actual, expected, message) => { assert.deepEqual(wire(actual), wire(expected), message); assertions++; };
  const call = async (method, path, body, status) => {
    const response = await send(method, path, body);
    eq(response.status, status, `${test.title} ${method} ${path}: ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const { resource, strict } = test;
  const core = resource === "Widget" ? "urn:example:params:scim:schemas:core:2.0:Widget"
    : `urn:ietf:params:scim:schemas:core:2.0:${resource}`;
  const primary = resource === "User" ? "userName" : "displayName";
  const records = readOnly => ({
    name: "records", type: "complex", multiValued: true, subAttributes: [
      { name: "value", type: "string" }, { name: "type", type: "string" },
      { name: "label", type: "string", required: true },
      { name: "server", type: "string", mutability: readOnly ? "readOnly" : "readWrite" },
      { name: "fixed", type: "string", mutability: "immutable" },
    ],
  });
  const attrs = readOnly => [records(readOnly), {
    name: "outer", type: "complex", multiValued: true,
    subAttributes: [{ name: "value", type: "string" }, records(readOnly)],
  }];
  const profile = readOnly => ({
    schemas: [
      { id: core, name: resource, attributes: [{ name: primary, type: "string", required: true }, ...attrs(readOnly)] },
      { id: EXT, name: "PutEntries", attributes: attrs(readOnly) },
    ],
    resourceTypes: [{ id: resource, name: resource, endpoint: `/${resource}s`, schema: core,
      schemaExtensions: [{ schema: EXT, required: false }] }],
    settings: { StrictSchemaValidation: strict, RfcCompliantSubAttributes: false, IgnoreReadOnlyAttributesInPatch: true },
    serviceProviderConfig: { etag: { supported: true }, patch: { supported: true } },
  });
  const endpoint = await call("POST", "/scim/admin/endpoints", { name: `put-entries-${randomUUID()}`, profile: profile(false) }, 201);
  const admin = `/scim/admin/endpoints/${endpoint.id}`;
  try {
    const route = `/scim/endpoints/${endpoint.id}/${resource}s`;
    const inputs = [];
    const wrap = entries => ({ records: structuredClone(entries), outer: [{ value: "parent", records: structuredClone(entries) }] });
    for (const vector of vectors) {
      const entries = vector.before.map((entry, i) => ({ ...entry, label: "kept", server: `server-${i}`, fixed: `fixed-${i}` }));
      const input = { schemas: [core, EXT], [primary]: `entry-${randomUUID()}`, ...wrap(entries), [EXT]: wrap(entries) };
      const created = await call("POST", route, input, 201);
      inputs.push({ vector, input, id: created.id });
    }
    await call("PATCH", admin, { profile: profile(true) }, 200);
    for (const { vector, input, id } of inputs) {
      if (vector.immutableType) {
        const locked = profile(true);
        for (const schema of locked.schemas) {
          for (const attribute of schema.attributes) {
            const array = attribute.name === "records" ? attribute
              : attribute.name === "outer" ? attribute.subAttributes.find(child => child.name === "records") : undefined;
            if (array) array.subAttributes.find(child => child.name === "type").mutability = "immutable";
          }
        }
        await call("PATCH", admin, { profile: locked }, 200);
      }
      const item = `${route}/${id}`;
      const entries = vector.after.map(entry => ({ ...entry, label: "kept" }));
      const expected = vector.after.map((entry, i) => ({ ...entry, label: "kept",
        ...(vector.immutableType && entry.type === undefined && vector.before[vector.old[i]].type !== undefined
          ? { type: vector.before[vector.old[i]].type } : {}),
        ...(vector.old[i] === null ? {} : { server: `server-${vector.old[i]}`, fixed: `fixed-${vector.old[i]}` }),
      }));
      const body = { schemas: [core, EXT], [primary]: input[primary], ...wrap(entries), [EXT]: wrap(entries) };
      const replaced = await call("PUT", item, body, 200);
      for (const part of [replaced, replaced[EXT]]) eq({ records: part.records, outer: part.outer }, wrap(expected), vector.name);
      const before = await call("GET", item, undefined, 200);
      eq(before.meta.version, replaced.meta.version);
      for (const key of Object.keys(before)) eq(
        ["schemas", "id", "meta", primary, "active", "externalId", "members", "records", "outer", EXT].includes(key), true);
      for (const namespace of [null, EXT]) {
        for (const attribute of ["records", "outer"]) {
          if (!expected.length || vector.old[0] === null) continue;
          for (const problem of ["required", "immutable"]) {
            const invalid = structuredClone(body);
            const part = namespace ? invalid[namespace] : invalid;
            const entry = attribute === "records" ? part.records[0] : part.outer[0].records[0];
            if (problem === "required") delete entry.label;
            else entry.fixed = "changed";
            invalid[primary] = `must-not-save-${randomUUID()}`;
            const error = await call("PUT", item, invalid, 400);
            eq(error.scimType, problem === "required" ? "invalidValue" : "mutability");
            eq(error.status, "400");
            for (const key of Object.keys(error)) eq(["schemas", "status", "scimType", "detail", DIAG].includes(key), true);
            eq(await call("GET", item, undefined, 200), before, "whole payload and version unchanged");
          }
        }
      }
      // Replacing the now persisted order proves PATCH shares the same identity
      // contract. All immutable inputs are explicit; PUT omission is not PATCH.
      const patchEntries = expected.map(({ server, ...entry }) => entry);
      const patched = await call("PATCH", item, {
        schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
        Operations: [{ op: "replace", path: "records", value: patchEntries },
          { op: "replace", path: `${EXT}:records`, value: patchEntries }],
      }, vector.name === "null versus absent" ? 400 : 200);
      if (vector.name === "null versus absent") {
        eq(patched.scimType, "mutability");
        eq(await call("GET", item, undefined, 200), before, "ambiguous null unassignment is atomic");
        continue;
      }
      const patchExpected = expected.map(entry => Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null)));
      eq(patched.records, patchExpected, "PATCH normalization and retained state");
      eq(patched[EXT].records, patchExpected);
      if (vector.immutableType) await call("PATCH", admin, { profile: profile(true) }, 200);
    }
  } finally {
    await call("DELETE", admin, undefined, 204);
    await call("GET", admin, undefined, 404);
  }
  return { title: test.title, assertions };
}
module.exports = { cases, runCase };
