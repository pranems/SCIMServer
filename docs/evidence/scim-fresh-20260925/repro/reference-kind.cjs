function isTestReference(file) {
  const normalized = file.replaceAll("\\", "/");
  return (
    /\.(?:spec|test)\.tsx?$/i.test(normalized) ||
    /(?:^|\/)(?:test|e2e)(?:\/|$)/i.test(normalized)
  );
}

module.exports = { isTestReference };

if (require.main === module) {
  const assert = require("node:assert/strict");
  const cases = [
    ["api/src/example.spec.ts", true],
    ["web/src/example.spec.tsx", true],
    ["api/src/example.test.ts", true],
    ["web/src/example.test.tsx", true],
    ["web/src/pages/EndpointRelatedSettings.test.tsx", true],
    ["web/src/pages/SettingsTab.test.tsx", true],
    ["api/test/e2e/helpers/app.helper.ts", true],
    ["api/test/helper.ts", true],
    ["web/e2e/fixtures.ts", true],
    ["test/e2e/input.json", true],
    ["api\\src\\example.spec.ts", true],
    ["web\\src\\pages\\SettingsTab.test.tsx", true],
    ["api\\test\\e2e\\helper.ts", true],
    ["web/src/example.TEST.TSX", true],
    ["web/src/pages/SettingsTab.tsx", false],
    ["api/src/example.ts", false],
    ["api/src/test-service/helper.ts", false],
    ["api/src/contest/example.ts", false],
    ["api/src/example.specification.ts", false],
    ["web/src/example.test.tsx.backup", false],
  ];
  for (const [file, expected] of cases) {
    assert.equal(isTestReference(file), expected, file);
  }
  console.log(`Lexical reference classifier: ${cases.length}/${cases.length} passed.`);
}
