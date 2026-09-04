/**
 * Flag-registry UI COVERAGE - the reverse direction of the conformance gate.
 *
 * `endpoint-config-conformance.spec.ts` F-T4 asserts the UI never offers a key
 * the server does not know. That is one direction only, and the other direction
 * had no gate at all: a flag could be registered, validated, bounded, persisted
 * and enforced while never appearing in the UI, so an operator had no way to
 * reach it. Eleven flags had drifted into exactly that state.
 *
 * Kept in its OWN file rather than folded into the conformance spec because the
 * two ask different questions. F-T4 failing means the UI misleads the operator
 * about what they control. This failing means a control exists that the operator
 * cannot find. Merging them would blur which one fired.
 *
 * TWO FALSE-GREEN ATTEMPTS SHAPED THIS FILE, both caught by the negative control:
 *
 *   1. `ui.includes(key)` matched `MaxActiveWifTrustsREMOVED` when looking for
 *      `MaxActiveWifTrusts`, so a removal was undetectable. A bare-substring
 *      check is simultaneously a false-positive and a false-negative generator.
 *
 *   2. Scanning ALL of web/src for the identifier then matched the flag name
 *      inside its own `label:` and `description:` prose. A flag mentioned only
 *      in a sentence is NOT an operator-reachable control, so that scan counted
 *      documentation as coverage.
 *
 * The answer to both is to look for a DECLARED control: a `key: '<flag>'` entry
 * in the settings arrays. Controls that are genuinely bespoke (a radio group, a
 * dedicated card) cannot be found that way, so they are declared explicitly in
 * BESPOKE_UI below - which makes them a reviewed decision instead of a silent
 * exemption.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENDPOINT_CONFIG_FLAGS } from './endpoint-config.interface';

const repoRoot = join(__dirname, '..', '..', '..', '..');

/** Files whose declarative settings arrays constitute the operator surface. */
const SETTINGS_SOURCES = [
  join('web', 'src', 'pages', 'SettingsTab.tsx'),
  join('web', 'src', 'pages', 'SettingsPage.tsx'),
  // The auth-method flags moved here when the Connect tab began rendering them
  // inline as well; both pages import this one list. Leaving it out made all
  // five read as unreachable, which is the gate working - a control the scan
  // cannot see is indistinguishable from one that does not exist.
  join('web', 'src', 'pages', 'endpoint-auth-flags.ts'),
];

/**
 * Flags rendered by a purpose-built control rather than a declarative row.
 * Each entry names WHERE, so the claim is checkable rather than asserted.
 */
const BESPOKE_UI: Record<string, string> = {
  CredentialSecretVisibility:
    'Rendered as an always|once radio group on the Settings tab, not a generic row. ' +
    'Covered by web/e2e/credential-secret-visibility.spec.ts.',
};

/**
 * Flags deliberately absent from the UI. EVERY entry needs a reason, in the same
 * spirit as .trivyignore: an unexplained suppression is indistinguishable from an
 * oversight, which is how the original eleven accumulated.
 */
const INTENTIONALLY_NOT_IN_UI: Record<string, string> = {};

/** Keys declared as controls, i.e. `key: '<flag>'` in a settings array. */
function declaredControlKeys(): string[] {
  return SETTINGS_SOURCES.flatMap((rel) => {
    const src = readFileSync(join(repoRoot, rel), 'utf8');
    return [...src.matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1]);
  });
}

function bespokeRendered(flag: string): boolean {
  if (!BESPOKE_UI[flag]) return false;
  // The claim must still hold: the identifier has to appear as a whole word in a
  // settings source, so a stale entry cannot keep excusing a control that has gone.
  const boundary = new RegExp(`(?<![A-Za-z0-9_])${flag}(?![A-Za-z0-9_])`);
  return SETTINGS_SOURCES.some((rel) => boundary.test(readFileSync(join(repoRoot, rel), 'utf8')));
}

describe('endpoint config flag UI coverage', () => {
  const registered = Object.values(ENDPOINT_CONFIG_FLAGS) as string[];

  it('U-T1: every registered flag is reachable as a control in the UI', () => {
    const declared = declaredControlKeys();
    const unreachable = registered.filter(
      (k) => !declared.includes(k) && !bespokeRendered(k) && !(k in INTENTIONALLY_NOT_IN_UI),
    );
    expect(unreachable).toEqual([]);
  });

  it('U-T2: every bespoke/excluded entry is still a real registered flag', () => {
    // Stops an allowlist outliving the flag it excuses and quietly weakening
    // U-T1, the same rot the .trivyignore staleness checker exists to catch.
    for (const key of [...Object.keys(BESPOKE_UI), ...Object.keys(INTENTIONALLY_NOT_IN_UI)]) {
      expect(registered).toContain(key);
    }
  });

  it('U-T3: every bespoke/excluded entry carries a non-trivial reason', () => {
    for (const reason of [...Object.values(BESPOKE_UI), ...Object.values(INTENTIONALLY_NOT_IN_UI)]) {
      expect(typeof reason).toBe('string');
      expect(reason.trim().length).toBeGreaterThan(20);
    }
  });

  it('U-T4 (control): a flag declared nowhere is not silently matched', () => {
    // Without this, U-T1 would also pass if the scan matched everything - a gate
    // that cannot fail is the defect it exists to prevent.
    expect(declaredControlKeys()).not.toContain('ThisFlagDoesNotExistAnywhere');
  });

  it('U-T5 (control): a LONGER identifier does not satisfy a shorter flag name', () => {
    // False-green #1: includes() matched MaxActiveWifTrustsREMOVED while looking
    // for MaxActiveWifTrusts, so a removal was undetectable.
    expect(['MaxActiveWifTrustsREMOVED'].includes('MaxActiveWifTrusts')).toBe(false);
  });

  it('U-T6 (control): prose alone is NOT coverage', () => {
    // False-green #2: scanning all of web/src matched the flag name inside its
    // own description string, so documentation counted as a control.
    const proseOnly = "description: 'Bounds how many MaxActiveWifTrusts exist.'";
    expect([...proseOnly.matchAll(/\bkey:\s*'([^']+)'/g)].map((m) => m[1])).toEqual([]);
  });
});
