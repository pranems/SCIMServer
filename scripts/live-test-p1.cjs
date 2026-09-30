// The standalone P1 entry point is ownership-guarded. The main live runner
// reuses only runP1Contract with an explicitly authorized target.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { API, testGuard } = require("./p1-validation/safety.cjs");

async function runLiveP1(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret && secret.length >= 32);
  return runP1Contract(baseUrl, secret);
}

// Explicit live-runner targets need no database access. The owned P1 entry point
// above retains every source, database and loopback guard.
async function runP1Contract(baseUrl, secret) {
  const base = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(base.protocol));
  assert.ok(secret);
  const Module = require("node:module");
  const ts = require(path.join(API, "node_modules", "typescript"));
  const file = path.join(API, "test", "e2e", "helpers", "typed-patch-fixtures.ts");
  const loaded = new Module(file, module);
  loaded._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, file);
  const f = loaded.exports;
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  async function http(method, route, body) {
    const response = await fetch(`${baseUrl}${route}`, {
      method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/scim+json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, etag: response.headers.get("etag"), body: await response.json() };
  }
  for (const strict of [true, false]) {
    const endpoint = await http("POST", "/scim/admin/endpoints", {
      name: `p1-live-${require("node:crypto").randomUUID()}`, profile: f.typedPatchProfile(strict),
    });
    eq(endpoint.status, 201);
    try {
      for (const [family, core] of [["Users", f.USER], ["Groups", f.GROUP], ["Devices", f.DEVICE]]) {
        const route = `/scim/endpoints/${endpoint.body.id}/${family}`;
        const created = await http("POST", route, {
          schemas: [core, f.GOOGLE, f.CONTOSO], displayName: "synthetic",
          ...(family === "Users" ? { userName: `p1-${require("node:crypto").randomUUID()}` } : {}),
          ...f.incidentPayload(),
        });
        eq(created.status, 201);
        const resource = `${route}/${created.body.id}`;
        const changed = await http("PATCH", resource, { schemas: [f.PATCH], Operations: f.incidentOperations() });
        eq(changed.status, 200);
        const read = await http("GET", resource);
        eq(read.status, 200);
        eq(read.body[f.GOOGLE], f.incidentExpected()[f.GOOGLE]);
        eq(read.body[f.CONTOSO], f.incidentExpected()[f.CONTOSO]);
        const failed = await http("PATCH", resource, { schemas: [f.PATCH], Operations: [
          f.incidentOperations()[0],
          { op: "replace", path: `${f.CONTOSO}:contacts[primary xx true].value`, value: "bad" },
        ] });
        eq(failed.status, 400);
        eq(failed.body.scimType, "invalidPath");
        const after = await http("GET", resource);
        eq(after.body, read.body);
        eq(after.etag, read.etag);
      }
    } finally {
      const deleted = await fetch(`${baseUrl}/scim/admin/endpoints/${endpoint.body.id}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${secret}` },
      });
      eq(deleted.status, 204);
    }
  }
  return { assertions, strictModes: [true, false], families: ["Users", "Groups", "Devices"] };
}
module.exports = { runLiveP1, runP1Contract };
if (require.main === module) {
  runLiveP1(process.env.P1_BASE_URL, process.env.P1_SHARED_SECRET)
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
