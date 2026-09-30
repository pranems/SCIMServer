import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENDPOINT_CONFIG_FLAGS_DEFINITIONS as definitions } from './endpoint-config.interface';

function assertCompleteSettingsTable(markdown: string): void {
  const rows = markdown.split('\n').filter(line => /^\| `[^`]+` \|/.test(line));
  expect(rows.map(row => row.split('`')[1]).sort())
    .toEqual(Object.values(definitions).map(definition => definition.key).sort());
  for (const row of rows) {
    const cells = row.split('|').slice(1, -1).map(cell => cell.trim());
    expect(cells).toHaveLength(6);
    for (const cell of cells) expect(cell.length).toBeGreaterThan(0);
  }
}

describe('operator-facing setting descriptions', () => {
  it('does not recommend blanket leniency for Entra', () => {
    expect(definitions.STRICT_SCHEMA_VALIDATION.description).not.toContain('Set false for Entra');
    expect(definitions.STRICT_SCHEMA_VALIDATION.description).toContain('Keep enabled');
    expect(definitions.VERBOSE_PATCH_SUPPORTED.description).not.toContain('disable for Entra');
  });

  it('labels retained no-op and unsupported visibility choices honestly', () => {
    expect(definitions.PERSIST_REQUEST_SECRETS.description).toContain('always redacted');
    expect(definitions.PERSIST_REQUEST_SECRETS.description).toContain('compatibility');
    expect(definitions.CREDENTIAL_SECRET_VISIBILITY.description).toContain('"once" is rejected');
  });

  it('does not claim the input coercion switch controls output conversion', () => {
    expect(definitions.ALLOW_AND_COERCE_BOOLEAN_STRINGS.description).not.toContain('GET/LIST output');
    expect(definitions.ALLOW_AND_COERCE_BOOLEAN_STRINGS.description).toContain('native');
  });

  it('describes the integrated explicit-path rejection without promising literal-key storage', () => {
    expect(definitions.VERBOSE_PATCH_SUPPORTED.description).toContain(
      'When false (default), rejects explicit core dotted User paths with 400 invalidPath and no write',
    );
    expect(definitions.VERBOSE_PATCH_SUPPORTED.description).not.toContain('stored as literal');
  });

  it('describes active-string rejection in both strict modes after the flag follow-up', () => {
    expect(definitions.ALLOW_AND_COERCE_BOOLEAN_STRINGS.description).toContain(
      'When OFF, quoted User active PATCH values are rejected in both strict modes',
    );
    expect(definitions.ALLOW_AND_COERCE_BOOLEAN_STRINGS.description).not.toContain('not fully gated');
  });

  const evidence = readFileSync(resolve(__dirname, '../../../../docs/SCIM_SETTINGS_BEHAVIOR_EVIDENCE.md'), 'utf8');
  it('keeps every registered setting in the evidence table with an explicit layer disposition', () => {
    assertCompleteSettingsTable(evidence);
  });

  it('the inventory sentinel detects a removed row, not just a setting name elsewhere in prose', () => {
    const missingRow = evidence.replace(/^\| `StrictSchemaValidation` \|.*\r?\n/m, '');
    expect(() => assertCompleteSettingsTable(missingRow)).toThrow();
  });
});
