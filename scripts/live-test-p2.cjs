const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { API, testGuard } = require("./p1-validation/safety.cjs");

async function runLiveP2(baseUrl, secret) {
  await testGuard();
  assert.equal(new URL(baseUrl).hostname, "127.0.0.1");
  assert.equal(new URL(baseUrl).protocol, "http:");
  assert.ok(secret?.length >= 32);
  return runP2Contract(baseUrl, secret);
}

async function runP2Contract(baseUrl, secret) {
  assert.ok(["http:", "https:"].includes(new URL(baseUrl).protocol));
  assert.ok(secret);
  const file = path.join(API, "test", "e2e", "helpers", "typed-patch-fixtures.ts");
  const loaded = new (require("node:module"))(file, module);
  loaded._compile(require(path.join(API, "node_modules", "typescript")).transpileModule(
    fs.readFileSync(file, "utf8"), { compilerOptions: { module: 1 } },
  ).outputText, file);
  const f = loaded.exports;
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const http = async (method, route, body) => {
    const response = await fetch(`${baseUrl}${route}`, {
      method, signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/scim+json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, etag: response.headers.get("etag"), body: response.status === 204 ? null : await response.json() };
  };
  for (const strict of [true, false]) {
    const profile = structuredClone(f.typedPatchProfile(strict));
    profile.settings.PrimaryEnforcement = "reject";
    profile.schemas.find(s => s.id === f.CONTOSO).attributes.push(
      { name: "tags", type: "string", multiValued: true, required: false },
      { name: "requiredValue", type: "string", multiValued: false, required: true },
      { name: "identity", type: "string", multiValued: false, required: false, mutability: "immutable" },
    );
    const endpoint = await http("POST", "/scim/admin/endpoints", { name: `p2-live-${require("node:crypto").randomUUID()}`, profile });
    eq(endpoint.status, 201);
    try {
      for (const [family, core] of [["Users", f.USER], ["Groups", f.GROUP], ["Devices", f.DEVICE]]) {
        const route = `/scim/endpoints/${endpoint.body.id}/${family}`;
        const created = await http("POST", route, {
          schemas: [core, f.CONTOSO], displayName: "synthetic",
          ...(family === "Users" ? { userName: `p2-${require("node:crypto").randomUUID()}` } : {}),
          [f.CONTOSO]: { requiredValue: "required", tags: ["a"], contacts: [
            { type: "work", value: "one", primary: true }, { type: "work", value: "two", primary: false },
          ] },
        });
        eq(created.status, 201);
        const url = `${route}/${created.body.id}`;
        const changed = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "add", path: `${f.CONTOSO}:tags`, value: "b" },
          { op: "add", value: { [f.CONTOSO]: { tags: ["c"] } } },
          { op: "replace", path: `${f.CONTOSO}:contacts[value eq "two"].primary`, value: true },
          { op: "replace", path: `${f.CONTOSO}:contacts[primary eq true].value`, value: "selected" },
          { op: "replace", path: `${f.CONTOSO}:contacts[type eq "work"]`, value: { type: "updated" } },
        ] });
        eq(changed.status, 200);
        const expected = { requiredValue: "required", tags: ["a", "b", "c"], contacts: [
          { type: "updated", value: "one", primary: false }, { type: "updated", value: "selected", primary: true },
        ] };
        eq(changed.body[f.CONTOSO], expected);
        const read = await http("GET", url);
        eq(read.status, 200);
        eq(read.body[f.CONTOSO], expected);
        eq(JSON.stringify(read.body).includes("contacts["), false);
        const badCases = [
          [{ op: "replace", path: `${f.CONTOSO}:unknown[primary eq true].value`, value: "bad" }],
          [{ op: "replace", path: `${f.CONTOSO}:contacts[primary xx true].value`, value: "bad" }],
          ...[
            [{ op: "remove", path: `${f.CONTOSO}:requiredValue` }, { op: "add", path: `${f.CONTOSO}:requiredValue`, value: "repair" }],
            [{ op: "add", path: `${f.CONTOSO}:identity`, value: "first" }, { op: "replace", path: `${f.CONTOSO}:identity`, value: "second" }],
          ],
        ];
        for (const operations of badCases) {
          const rejected = await http("PATCH", url, { schemas: [f.PATCH], Operations: operations });
          eq(rejected.status, 400);
          const after = await http("GET", url);
          eq(after.body, read.body);
          eq(after.etag, read.etag);
        }
      }
    } finally {
      eq((await http("DELETE", `/scim/admin/endpoints/${endpoint.body.id}`)).status, 204);
    }
  }
  for (const strict of [true, false]) {
    for (const coerce of [true, false]) {
      const profile = structuredClone(f.typedPatchProfile(strict));
      profile.settings.VerbosePatchSupported = false;
      profile.settings.AllowAndCoerceBooleanStrings = coerce;
      const endpoint = await http("POST", "/scim/admin/endpoints", {
        name: `p2-flags-live-${require("node:crypto").randomUUID()}`, profile,
      });
      eq(endpoint.status, 201);
      try {
        const route = `/scim/endpoints/${endpoint.body.id}/Users`;
        const created = await http("POST", route, {
          schemas: [f.USER], userName: `p2-${require("node:crypto").randomUUID()}`, active: true,
          name: { givenName: "Given", familyName: "Before" },
          emails: [{ value: "old@example.test", type: "home", primary: true }],
        });
        eq(created.status, 201);
        const url = `${route}/${created.body.id}`;
        const appended = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "add", path: "emails", value: [{ value: "new@example.test", type: "work", primary: true }] },
        ] });
        eq(appended.status, 200);
        eq(appended.body.emails, [
          { value: "old@example.test", type: "home", primary: false },
          { value: "new@example.test", type: "work", primary: true },
        ]);
        const blocked = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "replace", path: "displayName", value: "must-not-persist" },
          { op: "replace", path: "name.familyName", value: "wrong" },
        ] });
        eq(blocked.status, 400);
        eq(blocked.body.scimType, "invalidPath");
        eq(blocked.body[f.DIAGNOSTICS].failedOperationIndex, 1);
        const unchanged = await http("GET", url);
        eq(unchanged.body, appended.body);
        eq(unchanged.etag, appended.etag);
        eq(Object.hasOwn(unchanged.body, "name.familyName"), false);
        const pathless = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "replace", value: { "name.familyName": "After" } },
        ] });
        eq(pathless.status, 200);
        eq(pathless.body.name, { givenName: "Given", familyName: "After" });
        eq(Object.hasOwn(pathless.body, "name.familyName"), false);
        const quoted = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "replace", path: "active", value: "False" },
        ] });
        eq(quoted.status, coerce ? 200 : 400);
        const afterQuoted = await http("GET", url);
        if (coerce) eq(afterQuoted.body.active, false);
        else {
          eq(quoted.body.scimType, "invalidValue");
          eq(afterQuoted.body, pathless.body);
          eq(afterQuoted.etag, pathless.etag);
        }
        const native = await http("PATCH", url, { schemas: [f.PATCH], Operations: [
          { op: "replace", path: "active", value: false },
        ] });
        eq(native.status, 200);
        eq((await http("GET", url)).body.active, false);
      } finally {
        eq((await http("DELETE", `/scim/admin/endpoints/${endpoint.body.id}`)).status, 204);
      }
    }
  }
  return {
    assertions, families: ["Users", "Groups", "Devices"], strictModes: [true, false],
    defaultRunningCompatibilityCases: ["I02", "I03", "E17", "active-coercion-flag"],
  };
}
module.exports = { runLiveP2, runP2Contract };
