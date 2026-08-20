/**
 * Flag-registry conformance.
 *
 * `CustomResourceTypesEnabled` was retired from the registry in settings-v8 but
 * stayed wired into the UI for months: the tab hid Create/Delete and the
 * Settings tab offered a toggle the server ignored. Nothing failed, because no
 * test compared the two sides. These do.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENDPOINT_CONFIG_FLAGS, ENDPOINT_CONFIG_FLAGS_DEFINITIONS } from './endpoint-config.interface';

const repoRoot = join(__dirname, '..', '..', '..', '..');

function settingsTabKeys(): string[] {
  const src = readFileSync(join(repoRoot, 'web', 'src', 'pages', 'SettingsTab.tsx'), 'utf8');
  return [...src.matchAll(/^\s+key: '([^']+)'/gm)].map((m) => m[1]);
}

describe('endpoint config flag registry conformance', () => {
  const registered = Object.values(ENDPOINT_CONFIG_FLAGS) as string[];

  it('F-T1: every flag constant has a definition, and vice versa', () => {
    const defined = Object.values(ENDPOINT_CONFIG_FLAGS_DEFINITIONS).map((d) => d.key);
    expect([...defined].sort()).toEqual([...registered].sort());
  });

  it('F-T2: every definition declares a type and a default', () => {
    for (const def of Object.values(ENDPOINT_CONFIG_FLAGS_DEFINITIONS)) {
      expect(typeof def.type).toBe('string');
      expect(def).toHaveProperty('default');
    }
  });

  it('F-T3: every numeric flag declares BOTH bounds', () => {
    // An unbounded number is indistinguishable from an unregistered key at
    // runtime, which is the gap the 9z-CD/9z-CE controls exist to show.
    for (const def of Object.values(ENDPOINT_CONFIG_FLAGS_DEFINITIONS)) {
      if (def.type !== 'number') continue;
      expect(typeof def.min).toBe('number');
      expect(typeof def.max).toBe('number');
      expect(def.min as number).toBeLessThan(def.max as number);
    }
  });

  it('F-T4: the Settings UI never offers a key the server does not know', () => {
    // The exact defect: a toggle for a retired flag writes a setting nothing
    // reads, so the operator is misled about what they control.
    const orphans = settingsTabKeys().filter((k) => !registered.includes(k));
    expect(orphans).toEqual([]);
  });

  it('F-T5: retired flags stay retired', () => {
    const retired = [
      'CustomResourceTypesEnabled',
      'BulkOperationsEnabled',
      'SoftDeleteEnabled',
      'ReprovisionOnConflictForSoftDeletedResource',
      'MultiOpPatchRequestAddMultipleMembersToGroup',
      'MultiOpPatchRequestRemoveMultipleMembersFromGroup',
    ];
    for (const key of retired) {
      expect(registered).not.toContain(key);
      expect(settingsTabKeys()).not.toContain(key);
    }
  });
});
