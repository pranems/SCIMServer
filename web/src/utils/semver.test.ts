import { describe, it, expect } from 'vitest';

// Extract the semver helpers from App.tsx for testing.
// They are inline in the component, so we replicate the exact logic here.
function normalize(v?: string | null): string | null {
  if (!v) return null;
  const trimmed = v.trim();
  const noPrefix = trimmed.startsWith('v') ? trimmed.slice(1) : trimmed;
  return noPrefix;
}

function semverNewer(remote: string, local: string): boolean {
  const rParts = remote.split('.').map(n => parseInt(n, 10));
  const lParts = local.split('.').map(n => parseInt(n, 10));
  for (let i = 0; i < Math.max(rParts.length, lParts.length); i++) {
    const r = rParts[i] || 0;
    const l = lParts[i] || 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false; // equal
}

describe('normalize', () => {
  it('returns null for empty/null/undefined', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize(undefined)).toBeNull();
    expect(normalize('')).toBeNull();
  });

  it('strips v prefix', () => {
    expect(normalize('v1.2.3')).toBe('1.2.3');
  });

  it('leaves bare version alone', () => {
    expect(normalize('1.2.3')).toBe('1.2.3');
  });

  it('trims whitespace', () => {
    expect(normalize('  v0.34.0  ')).toBe('0.34.0');
  });
});

describe('semverNewer', () => {
  it('detects newer major version', () => {
    expect(semverNewer('2.0.0', '1.0.0')).toBe(true);
  });

  it('detects newer minor version', () => {
    expect(semverNewer('0.35.0', '0.34.0')).toBe(true);
  });

  it('detects newer patch version', () => {
    expect(semverNewer('0.34.1', '0.34.0')).toBe(true);
  });

  it('returns false for equal versions', () => {
    expect(semverNewer('0.34.0', '0.34.0')).toBe(false);
  });

  it('returns false when remote is older', () => {
    expect(semverNewer('0.33.0', '0.34.0')).toBe(false);
  });

  it('handles different segment lengths', () => {
    expect(semverNewer('1.0.0', '1.0')).toBe(false);
    expect(semverNewer('1.0.1', '1.0')).toBe(true);
  });

  it('handles large version numbers', () => {
    expect(semverNewer('0.100.0', '0.99.0')).toBe(true);
  });

  it('correctly compares 0.9.1 vs 0.34.0', () => {
    // This was the old hardcoded fallback - verify it is indeed older
    expect(semverNewer('0.34.0', '0.9.1')).toBe(true);
    expect(semverNewer('0.9.1', '0.34.0')).toBe(false);
  });
});
