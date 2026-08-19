import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Model-coverage lock for the prod -> dev / cross-tenant mirror.
 *
 * Origin: 2026-08-05, tenant 08 -> 09 migration. The mirror copied 5 of the 8
 * Prisma models. The two omissions that mattered were `CredentialDek` and the
 * `secretEnvelope` column on `EndpointCredential`: together they meant every
 * retained credential secret was silently lost on every mirror. Nothing looked
 * broken, because authentication compares the bcrypt `credentialHash`, which is
 * never encrypted and did travel. Only the admin "reveal secret" path failed,
 * and only when somebody asked for it - possibly weeks later.
 *
 * No gate could catch that, because a mirror that copies too little still exits
 * 0. This test is the gate: it pins the set of models the mirror writes to the
 * set of models the schema declares, so the NEXT model added to schema.prisma
 * cannot silently fall out of the mirror. Adding a model now forces a decision -
 * either mirror it, or name it in EXCLUDED_MODELS with a reason.
 */
describe('mirror-prod-to-dev model coverage', () => {
  const repoRoot = join(__dirname, '..', '..');
  const schema = readFileSync(join(repoRoot, 'prisma', 'schema.prisma'), 'utf8');
  const mirror = readFileSync(join(__dirname, 'mirror-prod-to-dev.ts'), 'utf8');

  /** Models deliberately NOT mirrored. Each entry needs a stated reason. */
  const EXCLUDED_MODELS: Record<string, string> = {};

  const declaredModels = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((m) => m[1]);

  /** `dst.credentialDek.create(...)` -> `CredentialDek` */
  const writtenModels = new Set(
    [...mirror.matchAll(/\bdst\.(\w+)\.(?:create|update|upsert|createMany)\b/g)].map(
      (m) => m[1].charAt(0).toUpperCase() + m[1].slice(1),
    ),
  );

  it('declares the eight models this test was written against', () => {
    // A tripwire: if this fails, the schema grew or shrank and the assertions
    // below deserve a fresh look rather than a mechanical update.
    expect(declaredModels.length).toBeGreaterThanOrEqual(8);
  });

  it('mirrors every model declared in schema.prisma', () => {
    const missing = declaredModels.filter(
      (m) => !writtenModels.has(m) && !(m in EXCLUDED_MODELS),
    );
    expect(missing).toEqual([]);
  });

  it('does not write to a model that no longer exists in the schema', () => {
    const stale = [...writtenModels].filter((m) => !declaredModels.includes(m));
    expect(stale).toEqual([]);
  });

  it('carries EndpointCredential.secretEnvelope, not just the hash', () => {
    // The bcrypt hash is what authenticates, so dropping the envelope produces a
    // mirror that passes every functional check while losing the retained secret.
    expect(mirror).toMatch(/secretEnvelope:\s*c\.secretEnvelope/);
  });

  it('carries the wrapped DEK whenever it carries credentials', () => {
    // secretEnvelope is encrypted under the DEK held in CredentialDek. Copying
    // one without the other yields envelopes nothing can open.
    expect(writtenModels.has('EndpointCredential')).toBe(true);
    expect(writtenModels.has('CredentialDek')).toBe(true);
  });

  /**
   * Negative controls. A coverage gate that cannot fail is worse than no gate,
   * because it reads green forever. These run the SAME extraction logic against
   * synthetic sources and assert it reports the omission, proving the checks
   * above would have caught the real 2026-08-05 defect.
   */
  describe('the gate itself can fail', () => {
    const extractWritten = (source: string) =>
      new Set(
        [...source.matchAll(/\bdst\.(\w+)\.(?:create|update|upsert|createMany)\b/g)].map(
          (m) => m[1].charAt(0).toUpperCase() + m[1].slice(1),
        ),
      );

    it('detects a model that the mirror never writes', () => {
      const doctored = extractWritten('await dst.endpoint.create({ data: {} });');
      const missing = declaredModels.filter(
        (m) => !doctored.has(m) && !(m in EXCLUDED_MODELS),
      );
      expect(missing).toContain('CredentialDek');
      expect(missing).toContain('JwksHostAllowlistEntry');
      expect(missing).toContain('ServerSetting');
    });

    it('detects a write to a model the schema no longer declares', () => {
      const doctored = extractWritten('await dst.longGoneModel.create({ data: {} });');
      const stale = [...doctored].filter((m) => !declaredModels.includes(m));
      expect(stale).toEqual(['LongGoneModel']);
    });

    it('detects credentials copied without their secret envelope', () => {
      const doctored = 'data: { credentialHash: c.credentialHash, active: c.active }';
      expect(doctored).not.toMatch(/secretEnvelope:\s*c\.secretEnvelope/);
    });
  });
});
