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
      'live-endpoint-conditional.cjs',
      'test-scim-query-semantics.ps1',
      'profile-validation.cjs',
      'Invoke-ScimGroupAggregateContract -EndpointUrl',
      'test-scim-endpoint-deletion.ps1',
      'entra-compatibility.cjs',
      'ordered-patch.cjs',
      'retained-entry-put.cjs',
      'Invoke-ScimAtomicUniquenessTests -BaseUrl',
      'common-externalid-patch.cjs',
    ]) {
      expect(source.includes(invocation)).toBe(true);
    }
    expect(source).toContain('finally');
    expect(source).toContain('-Method Delete');
    expect(read('live-test-sections/atomic-uniqueness.ps1')).toContain('Invoke-ScimAtomicUniquenessContract -EndpointUrl');
  });

  it('gives every integration section a unique identifier across main and shared runners', () => {
    const main = read('live-test.ps1');
    const search = read('live-test-sections/search-contract.ps1');
    const atomic = read('live-test-sections/atomic-uniqueness.ps1');
    const source = existsSync(resolve(scripts, section)) ? read(section) : main;
    const sections = [...`${main}\n${source}\n${search}\n${atomic}`.matchAll(/\$script:currentSection\s*=\s*['"](9z-(?:C[O-Z]|D[A-Z])):/g)]
      .map((match) => match[1]);
    expect(new Set(sections).size).toBe(sections.length);
    expect(sections.length).toBeGreaterThanOrEqual(15);
  });

  it('requires the expanded recursive readOnly live contract', () => {
    const source = read(section);
    expect(source.includes('$receipt.assertions -eq 472')).toBe(true);
    expect(source.includes('472 declaration, binding-context, POST/PUT, projection and cleanup assertions')).toBe(true);
  });

  it('requires all resolved compatibility and flag assertions without environment gating', () => {
    const source = read(section);
    expect(source.includes('SCIM_P9_INTEGRATION')).toBe(false);
    expect(source.includes('$receipt.assertions -eq 1228')).toBe(true);
    expect(source.includes('$receipt.assertions -eq 188')).toBe(true);
  });
});
