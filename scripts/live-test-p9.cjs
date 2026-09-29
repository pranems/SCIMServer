const assert = require("node:assert/strict");
const { testGuard } = require("./p1-validation/safety.cjs");
const { cases, runCase } = require("../api/test/e2e/corpus/entra-compatibility.cjs");

async function runLiveP9(baseUrl, secret) {
  await testGuard();
  const base = new URL(baseUrl);
  assert.equal(base.hostname, "127.0.0.1");
  assert.equal(base.protocol, "http:");
  assert.ok(secret.length >= 32);
  const outcomes = [];
  for (const test of cases.filter(item => !item.integration || process.env.SCIM_P9_INTEGRATION === "1")) {
    outcomes.push(await runCase(test, async (method, route, body) => {
      const response = await fetch(`${baseUrl}${route}`, {
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

module.exports = { runLiveP9 };
