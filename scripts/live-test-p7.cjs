// Owned loopback runtime only. The P1/P7 harness verifies source, backend,
// container and database ownership before this live HTTP smoke can execute.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { testGuard } = require("./p1-validation/safety.cjs");

async function runLiveP7(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret.length >= 32);
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const http = async (method, route, body) => {
    const response = await fetch(`${baseUrl}${route}`, {
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
          { id: core, name: resource, attributes: [{ name: primary, type: "string", required: true }, ...attrs] },
          { id: EXT, name: "Live", attributes: [{ name: "requiredValue", type: "string", required: true }, ...attrs] },
        ],
        resourceTypes: [{ id: resource, name: resource, endpoint: `/${resource}s`, schema: core,
          schemaExtensions: [{ schema: EXT, required: true }] }],
        settings: { StrictSchemaValidation: strict },
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
        observed.push({ resource, strict, create: created.status, replace: replacement.status, immutableError: rejected.body.scimType });
      } finally {
        eq((await http("DELETE", admin)).status, 204);
      }
    }
  }
  return { assertions, observed, endpointCleanup: "deleted" };
}
module.exports = { runLiveP7 };
