// The P1/P7 entry point retains ownership guards. The main live runner shares
// only the explicit-target HTTP contract through runP7Contract.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { API, testGuard } = require("./p1-validation/safety.cjs");
const { liveFetch } = require("./live-test-http.cjs");

async function runLiveP7(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret.length >= 32);
  return runP7Contract(baseUrl, secret);
}

async function runP7Contract(baseUrl, secret) {
  const base = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(base.protocol));
  assert.ok(secret);
  const ts = require(path.join(API, "node_modules", "typescript"));
  const loadFixture = name => {
    const fixture = path.join(API, "test", "e2e", "helpers", name);
    const loaded = new Module(fixture, module);
    loaded._compile(ts.transpileModule(fs.readFileSync(fixture, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, fixture);
    return loaded.exports;
  };
  const { recursiveReadOnlyAttribute, recursiveReadOnlyInput, recursiveReadOnlyExpected } = loadFixture("profile-p7-readonly.fixture.ts");
  const { commonContextProfile, SHARED_COMMON_SCHEMA, OTHER_COMMON_SCHEMA } = loadFixture("profile-p7-common-context.fixture.ts");
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const http = async (method, route, body) => {
    const response = await liveFetch(`${baseUrl}${route}`, {
      method,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/scim+json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };
  const EXT = "urn:example:params:scim:schemas:extension:p7:2.0:Live";
  const observed = [];
  for (const strict of [false, true]) {
    for (const resource of ["User", "Group", "Widget"]) {
      const core = resource === "Widget" ? "urn:example:core:2.0:Widget" : `urn:ietf:params:scim:schemas:core:2.0:${resource}`;
      const primary = resource === "User" ? "userName" : "displayName";
      const attrs = [
        recursiveReadOnlyAttribute(),
        { name: "fixed", type: "string", mutability: "immutable" },
        { name: "serverOwned", type: "integer", mutability: "readOnly" },
        { name: "encoded", type: "binary" }, { name: "link", type: "reference" },
        { name: "stamp", type: "dateTime" }, { name: "asked", type: "string", returned: "request" },
        { name: "hidden", type: "string", returned: "never" },
        { name: "children", type: "complex", multiValued: true, subAttributes: [
          { name: "value", type: "string", required: true }, { name: "labels", type: "string", multiValued: true },
        ] },
      ];
      const profile = {
        schemas: [
          { id: core, name: resource, attributes: [{ name: primary, type: "string", required: true }, { name: "externalId" }, ...attrs] },
          { id: EXT, name: "Live", attributes: [{ name: "requiredValue", type: "string", required: true },
            { name: "externalId", type: "integer", multiValued: true }, ...attrs] },
        ],
        resourceTypes: [{ id: resource, name: resource, endpoint: `/${resource}s`, schema: core,
          schemaExtensions: [{ schema: EXT, required: true }] }],
        settings: { StrictSchemaValidation: strict, RfcCompliantSubAttributes: false },
        serviceProviderConfig: { etag: { supported: true } },
      };
      const endpoint = await http("POST", "/scim/admin/endpoints", { name: `p7-live-${crypto.randomUUID()}`, profile });
      eq(endpoint.status, 201);
      const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
      try {
        const route = `/scim/endpoints/${endpoint.body.id}/${resource}s`;
        const beforeProfile = await http("GET", admin);
        const badProfile = structuredClone(profile);
        badProfile.schemas[0].attributes.push({ name: "bad", type: "imaginary" });
        eq((await http("PATCH", admin, { profile: badProfile })).status, 400);
        eq((await http("GET", admin)).body.profile, beforeProfile.body.profile);
        const required = await http("POST", route, { schemas: [core], [primary]: crypto.randomUUID() });
        eq(required.status, 400);
        eq(required.body.scimType, "invalidValue");
        const input = { schemas: [core, EXT], [primary]: `live-${crypto.randomUUID()}`, fixed: "first",
          serverOwned: { malformed: true }, asked: "requested", hidden: "never",
          encoded: "+/8=", link: "../Users/123", stamp: "2024-02-29T12:30:00Z",
          children: [{ value: "child", labels: ["one", "two"] }],
          [EXT]: { requiredValue: "present", fixed: "ext-first", encoded: "YWJj", asked: "ext-requested", hidden: "ext-never" },
        };
        const created = await http("POST", route, input);
        eq(created.status, 201);
        eq(created.body.serverOwned, undefined);
        eq(created.body.asked, "requested");
        eq(created.body[EXT].asked, "ext-requested");
        eq(created.body.hidden, undefined);
        eq(created.body[EXT].hidden, undefined);
        eq(created.body.children, input.children);
        const item = `${route}/${created.body.id}`;
        const replacement = await http("PUT", item, {
          schemas: [core, EXT], [primary]: input[primary], [EXT]: { requiredValue: "present" },
        });
        eq(replacement.status, 200);
        eq(replacement.body.fixed, "first");
        eq(replacement.body[EXT].fixed, "ext-first");
        const before = await http("GET", item);
        eq(before.body.asked, undefined);
        const rejected = await http("PUT", item, { ...input, fixed: "changed" });
        eq(rejected.status, 400);
        eq(rejected.body.scimType, "mutability");
        eq((await http("GET", item)).body, before.body);
        if (strict) {
          for (const [key, value] of [["encoded", "not base64!"], ["link", "https://exa mple.test"], ["stamp", "2023-02-29T12:00:00Z"]]) {
            const invalid = await http("PUT", item, { ...input, [key]: value });
            eq(invalid.status, 400);
            eq(invalid.body.scimType, "invalidValue");
            eq(typeof invalid.body.detail, "string");
            eq((await http("GET", item)).body, before.body);
          }
        }
        const nestedInput = { ...input, [primary]: `recursive-${crypto.randomUUID()}`,
          nested: recursiveReadOnlyInput(), [EXT]: { requiredValue: "present", nested: recursiveReadOnlyInput(false) } };
        const nestedCreated = await http("POST", route, nestedInput);
        eq(nestedCreated.status, 201);
        eq(nestedCreated.body.nested, recursiveReadOnlyExpected());
        eq(nestedCreated.body[EXT].nested, recursiveReadOnlyExpected());
        const nestedItem = `${route}/${nestedCreated.body.id}`;
        const nestedReplaced = await http("PUT", nestedItem, nestedInput);
        eq(nestedReplaced.status, 200);
        eq(nestedReplaced.body.nested, recursiveReadOnlyExpected());
        eq(nestedReplaced.body[EXT].nested, recursiveReadOnlyExpected());
        const nestedRead = await http("GET", nestedItem);
        eq(nestedRead.body.nested, recursiveReadOnlyExpected());
        eq(nestedRead.body[EXT].nested, recursiveReadOnlyExpected());
        const missing = structuredClone(nestedInput);
        delete missing.nested.records[0].details[0].open;
        const failedNested = await http("PUT", nestedItem, missing);
        eq(failedNested.status, 400);
        eq(failedNested.body.scimType, "invalidValue");
        eq(typeof failedNested.body.detail, "string");
        eq((await http("GET", nestedItem)).body, nestedRead.body);
        const clientInput = { ...input, [primary]: `common-${crypto.randomUUID()}`, externalId: "Client-AbC",
          [EXT]: { requiredValue: "present", externalId: [7, 9] } };
        const clientCreated = await http("POST", route, clientInput);
        eq(clientCreated.status, 201);
        eq(clientCreated.body.externalId, "Client-AbC");
        eq(clientCreated.body[EXT].externalId, [7, 9]);
        const clientItem = `${route}/${clientCreated.body.id}`;
        const clientBefore = await http("GET", clientItem);
        for (const externalId of [42, false, ["client"], { value: "client" }]) {
          const badPost = await http("POST", route, { ...clientInput, [primary]: `bad-${crypto.randomUUID()}`, externalId });
          eq(badPost.status, 400);
          eq(badPost.body.scimType, "invalidValue");
          eq(typeof badPost.body.detail, "string");
          const badPut = await http("PUT", clientItem, { ...clientInput, externalId });
          eq(badPut.status, 400);
          eq(badPut.body.scimType, "invalidValue");
          eq((await http("GET", clientItem)).body, clientBefore.body);
        }
        const clientDuplicate = await http("POST", route, { ...clientInput, [primary]: `duplicate-${crypto.randomUUID()}` });
        eq(clientDuplicate.status, 201);
        eq(clientDuplicate.body.externalId, "Client-AbC");
        const clientChanged = await http("PUT", clientItem, { ...clientInput, externalId: "Client-aBc" });
        eq(clientChanged.status, 200);
        eq(clientChanged.body.externalId, "Client-aBc");
        const badCommon = structuredClone(profile);
        Object.assign(badCommon.schemas[0].attributes.find(a => a.name === "externalId"), { type: "integer" });
        eq((await http("PATCH", admin, { profile: badCommon })).status, 400);
        eq((await http("GET", admin)).body.profile, beforeProfile.body.profile);
        observed.push({ resource, strict, create: created.status, replace: replacement.status,
          immutableError: rejected.body.scimType, recursiveReadOnly: "passed", commonExternalId: "passed" });
      } finally {
        eq((await http("DELETE", admin)).status, 204);
      }
    }
  }
  for (const strict of [false, true]) {
    const profile = commonContextProfile(strict);
    const endpoint = await http("POST", "/scim/admin/endpoints", { name: `p7-common-context-${crypto.randomUUID()}`, profile });
    eq(endpoint.status, 201);
    const admin = `/scim/admin/endpoints/${endpoint.body.id}`;
    const route = `/scim/endpoints/${endpoint.body.id}`;
    try {
      eq(endpoint.body.profile.schemas[0].attributes, profile.schemas[0].attributes);
      const core = { schemas: [SHARED_COMMON_SCHEMA], externalId: "Client-AbC", ID: [42], META: "spoof",
        displayName: [7, 9], active: "custom" };
      const created = await http("POST", `${route}/Shareds`, core);
      eq(created.status, 201);
      eq(created.body.ID, undefined);
      eq(created.body.META, undefined);
      eq(typeof created.body.id, "string");
      eq(created.body.externalId, "Client-AbC");
      eq(created.body.meta.resourceType, "Shared");
      eq(created.body.displayName, [7, 9]);
      eq(created.body.active, "custom");
      const item = `${route}/Shareds/${created.body.id}`;
      const replaced = await http("PUT", item, { ...core, id: { fake: true }, meta: [1], externalId: "Client-New" });
      eq(replaced.status, 200);
      eq(replaced.body.id, created.body.id);
      eq(replaced.body.meta.created, created.body.meta.created);
      eq(replaced.body.externalId, "Client-New");
      const rejected = await http("PUT", item, { ...core, externalId: [7] });
      eq(rejected.status, 400);
      eq(rejected.body.scimType, "invalidValue");
      eq((await http("GET", item)).body, replaced.body);
      const independent = { externalId: [11, 13], id: [17], meta: "extension", displayName: [19], active: "ext" };
      const extension = { schemas: [OTHER_COMMON_SCHEMA, SHARED_COMMON_SCHEMA], label: "other", [SHARED_COMMON_SCHEMA]: independent };
      const extCreated = await http("POST", `${route}/Others`, extension);
      eq(extCreated.status, 201);
      eq(extCreated.body[SHARED_COMMON_SCHEMA], independent);
      const extPut = await http("PUT", `${route}/Others/${extCreated.body.id}`, extension);
      eq(extPut.status, 200);
      eq(extPut.body[SHARED_COMMON_SCHEMA], independent);
      eq((await http("GET", admin)).body.profile.schemas[0].attributes, profile.schemas[0].attributes);
    } finally {
      eq((await http("DELETE", admin)).status, 204);
    }
  }
  return { assertions, observed, endpointCleanup: "deleted" };
}
module.exports = { runLiveP7, runP7Contract };
