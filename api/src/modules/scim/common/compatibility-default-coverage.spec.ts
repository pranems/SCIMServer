import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const loadCorpus = createRequire(__filename);
const { cases } = loadCorpus(resolve(__dirname, '../../../../test/e2e/corpus/entra-compatibility.cjs')) as {
  cases: { id: string; integration?: boolean }[];
};

describe('resolved compatibility regression discovery', () => {
  it.each(['I02', 'I03'])('executes resolved %s without an integration environment flag', id => {
    const defaultCaseIds = cases.filter(test => !test.integration).map(test => test.id);
    expect(defaultCaseIds).toContain(id);
  });

  it('keeps the complete corpus free of opt-in and TODO dispatch', () => {
    expect(cases).toHaveLength(19);
    expect(cases.every(test => !Object.hasOwn(test, 'integration'))).toBe(true);
    const http = readFileSync(resolve(__dirname, '../../../../test/e2e/entra-compatibility.e2e-spec.ts'), 'utf8');
    const live = readFileSync(resolve(__dirname, '../../../../../scripts/live-test-p9.cjs'), 'utf8');
    expect(/SCIM_P9_INTEGRATION|it\.todo/.test(http)).toBe(false);
    expect(/SCIM_P9_INTEGRATION|includeIntegration/.test(live)).toBe(false);
  });
});
