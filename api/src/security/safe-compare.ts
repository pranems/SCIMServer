/**
 * Timing-safe string comparison for credential/token equality checks.
 *
 * Uses Node's `crypto.timingSafeEqual()` so the time taken to compare two
 * equal-length buffers is independent of how many leading bytes match.
 * This eliminates timing-side-channel leaks that allow an attacker to
 * progressively guess a secret one byte at a time.
 *
 * Length mismatch returns `false` immediately - this is not a timing leak
 * because the length of an attacker-supplied input is already known to them.
 *
 * Closes S-2 (DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md and DELIVERY_PLAN.md section 3.2).
 *
 * @example
 *   import { safeCompare } from '../../security/safe-compare';
 *   if (safeCompare(token, expectedSecret)) { authenticated = true; }
 */
import { timingSafeEqual } from 'node:crypto';

export function safeCompare(a: string, b: string): boolean {
  // null / undefined / non-string guard - never accept
  if (typeof a !== 'string' || typeof b !== 'string') return false;

  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');

  // Length mismatch: return false without invoking timingSafeEqual.
  // crypto.timingSafeEqual throws on length mismatch, so we must guard.
  // Length is already known to the attacker (they sent the input), so an
  // early return on length mismatch leaks no additional information.
  if (bufA.length !== bufB.length) return false;

  return timingSafeEqual(bufA, bufB);
}
