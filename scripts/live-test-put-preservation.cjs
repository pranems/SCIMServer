const assert = require("node:assert/strict");
const { testGuard } = require("./p1-validation/safety.cjs");
const { cases, runCase } = require("../api/test/e2e/corpus/put-entry-preservation.cjs");

async function runLivePutPreservation(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret.length >= 32);
  return runPutPreservationContract(baseUrl, secret);
}

async function runPutPreservationContract(baseUrl, secret) {
  assert.ok(["http:", "https:"].includes(new URL(baseUrl).protocol));
  assert.ok(secret);
  const results = [];
  for (const test of cases) {
    results.push(await runCase(test, async (method, path, body) => {
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/scim+json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }));
  }
  return { cases: results.length, assertions: results.reduce((sum, result) => sum + result.assertions, 0), results };
}
module.exports = { runLivePutPreservation, runPutPreservationContract };
