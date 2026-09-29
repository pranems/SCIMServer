import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const scripts = resolve(__dirname, '../../../../../scripts');
const read = (file: string): string => readFileSync(resolve(scripts, file), 'utf8');
const section = 'live-test-sections/correctness-contracts.ps1';

describe('integrated correctness live coverage', () => {
  it('invokes the shared correctness section before the main runner cleanup', () => {
    const main = read('live-test.ps1');
    expect(main.includes('Invoke-ScimCorrectnessContractTests -BaseUrl $baseUrl -Headers $headers')).toBe(true);
    expect(main.indexOf('Invoke-ScimCorrectnessContractTests'))
      .toBeLessThan(main.indexOf('# TEST SECTION 10: DELETE OPERATIONS'));
  });

  it('routes every independent package through the shared section', () => {
    expect(existsSync(resolve(scripts, section))).toBe(true);
    const source = read(section);
    for (const invocation of [
      'Invoke-ScimSearchContractTests -BaseUrl',
      'test-scim-capability-boundary.ps1',
      'typed-patch.cjs',
      'Invoke-ScimConditionalWriteContract -EndpointUrl',
      'test-scim-endpoint-freshness.ps1',
    ]) {
      expect(source.includes(invocation)).toBe(true);
    }
    expect(source).toContain('finally');
    expect(source).toContain('-Method Delete');
  });

  it('gives every integration section a unique identifier across main and shared runners', () => {
    const main = read('live-test.ps1');
    const search = read('live-test-sections/search-contract.ps1');
    const source = existsSync(resolve(scripts, section)) ? read(section) : main;
    const sections = [...`${main}\n${source}\n${search}`.matchAll(/\$script:currentSection\s*=\s*['"](9z-C[O-Z]):/g)]
      .map((match) => match[1]);
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(new Set(sections).size).toBe(sections.length);
  });
});
