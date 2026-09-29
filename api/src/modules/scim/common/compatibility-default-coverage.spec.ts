import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const loadCorpus = createRequire(__filename);
const { cases } = loadCorpus(resolve(__dirname, '../../../../test/e2e/corpus/entra-compatibility.cjs')) as {
  cases: { id: string; integration: boolean }[];
};

describe('resolved compatibility regression discovery', () => {
  it('executes the fixed primary-handoff case without an integration environment flag', () => {
    const defaultCaseIds = cases.filter(test => !test.integration).map(test => test.id);
    expect(defaultCaseIds).toContain('I02');
  });
});
