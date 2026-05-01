/**
 * Tests for promote-to-prod.ps1 digest-pinning behavior.
 *
 * Closes OPS-2 (DELIVERY_PLAN.md Week 1 Day 5). The deploy script must:
 *   1. Resolve the dev image's immutable SHA-256 digest before promotion
 *   2. Use docker buildx imagetools inspect (or equivalent) for the resolution
 *   3. Pin the prod Container App with image@sha256:... NOT image:tag
 *   4. Display the digest in confirmation output so reviewers see what shipped
 *   5. Print a digest-pinned rollback command (using the prior prod digest)
 *
 * Why source-scan (not execution): the script requires Azure CLI auth and a
 * real Container App. A scan-based contract is fast, deterministic, and good
 * enough to catch a regression that removes digest pinning.
 *
 * If a NEW promotion mechanism replaces this one (e.g. blue/green from OPS-5),
 * the new mechanism must satisfy the same invariants - either by passing this
 * spec or by adding a parallel one and decommissioning this one explicitly.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const SCRIPT_PATH = path.join(REPO_ROOT, 'scripts', 'promote-to-prod.ps1');

describe('OPS-2: promote-to-prod.ps1 digest pinning', () => {
  let content: string;

  beforeAll(async () => {
    content = await fs.readFile(SCRIPT_PATH, 'utf8');
  });

  it('uses docker buildx imagetools inspect to resolve the immutable digest', () => {
    expect(content).toMatch(/docker\s+buildx\s+imagetools\s+inspect/);
  });

  it('captures the digest into a variable named like $devDigest or $imageDigest', () => {
    expect(content).toMatch(/\$(devDigest|imageDigest|digest)\b/);
  });

  it('constructs the promoted image reference with @sha256: pinning, not :tag', () => {
    // The desired-image construction must use the @<digest> form. The script
    // builds it via string interpolation: "ghcr.io/.../scimserver@$devDigest".
    // We assert the @<variable> form is present (digest is interpolated at
    // runtime - it is not a literal in source).
    expect(content).toMatch(/@\$(devDigest|imageDigest|digest)\b/);
  });

  it('does NOT promote prod with the mutable :tag form on the desired image', () => {
    // The desired image (the one that ships to prod) must NOT use :tag form.
    // It is fine for the script to construct "...:tag" as input to
    // `docker buildx imagetools inspect` for digest lookup; what is forbidden
    // is assigning that tag-form to $desiredImage and shipping it to prod.
    // Match: $desiredImage = "...:$ImageTag" or = "...:<literal-tag>"
    const desiredTagAssignment = /\$desiredImage\s*=\s*"[^"]*:\$?[A-Za-z]/;
    expect(content).not.toMatch(desiredTagAssignment);
  });

  it('reads the prior prod image (or its digest) before the swap so rollback is possible', () => {
    expect(content).toMatch(/\$prodImage\b/);
  });

  it('prints a digest-pinned rollback command at the end (or on failure)', () => {
    // The rollback hint must mention digest pinning so an operator does not
    // fall back to a mutable tag in an emergency.
    expect(content.toLowerCase()).toContain('rollback');
    expect(content).toMatch(/@sha256:|\$prodImage|\$priorProdImage|\$rollbackImage/);
  });

  it('exposes the digest in confirmation output so reviewers see the immutable ref', () => {
    // At least one Write-Host (or similar) line must reference the digest
    // before the actual az containerapp update.
    const lines = content.split(/\r?\n/);
    const digestPrintedSomewhere = lines.some((line) =>
      /Write-Host/i.test(line) && /digest/i.test(line),
    );
    expect(digestPrintedSomewhere).toBe(true);
  });

  it('refuses to proceed if digest resolution fails (defensive guard)', () => {
    // When buildx imagetools inspect fails, $LASTEXITCODE will be non-zero
    // OR the captured value will be empty. The script must guard.
    expect(content).toMatch(/digest.*-eq|-eq.*digest|digest.*IsNullOrWhiteSpace|IsNullOrWhiteSpace.*digest/i);
  });

  it('still supports the existing -SkipDevVerification / -SkipProdVerification switches', () => {
    // Backward compat - existing flags still work.
    expect(content).toMatch(/SkipDevVerification/);
    expect(content).toMatch(/SkipProdVerification/);
  });
});
