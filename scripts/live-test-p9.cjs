const assert = require("node:assert/strict");
const { testGuard } = require("./p1-validation/safety.cjs");
const { cases, runCase } = require("../api/test/e2e/corpus/entra-compatibility.cjs");
const { liveFetch } = require("./live-test-http.cjs");

async function runLiveP9(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret.length >= 32);
  return runP9Contract(baseUrl, secret);
}

async function runP9Contract(baseUrl, secret) {
  const base = new URL(baseUrl);
  assert.ok(["http:", "https:"].includes(base.protocol));
  assert.ok(secret);
  const outcomes = [];
  for (const test of cases) {
    outcomes.push(await runCase(test, async (method, route, body) => {
      const response = await liveFetch(`${baseUrl}${route}`, {
        method,
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/scim+json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }));
  }
  return { outcomes, assertions: outcomes.reduce((sum, item) => sum + item.assertions, 0) };
}

module.exports = { runLiveP9, runP9Contract };
