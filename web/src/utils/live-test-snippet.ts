/**
 * Phase M2 - live-test-snippet (paste-ready PowerShell emitter).
 *
 * THE killer differentiator from analysis-doc S4.2 - the only admin
 * UI that lets the operator round-trip from "exploration in the
 * Workbench" to "regression test in scripts/live-test.ps1" without
 * retyping. The Workbench history rows expose a "Save as live-test
 * step" button that calls this emitter.
 *
 * Output shape: a small block of PowerShell that:
 *   1. Opens with the section banner comment `# 9z-XX.N: <label>`
 *   2. Runs Invoke-RestMethod against `$baseUrl/<path>` with `$headers`
 *   3. Asserts the expected status with `Test-Result -Success ...`
 *
 * The operator pastes this directly into a new section in
 * scripts/live-test.ps1 alongside other 9z-* sections.
 *
 * @see web/src/utils/live-test-snippet.test.ts (TDD spec)
 * @see scripts/live-test.ps1 (target paste destination)
 * @see docs/PHASE_M2_BULK_OPERATIONS.md
 */

export interface LiveTestSnippetArgs {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Absolute path under /scim/* (will be wrapped in $baseUrl). */
  path: string;
  /** Optional request body (object or array). Omitted for GET / DELETE. */
  body?: unknown;
  /** Expected HTTP status code for the assertion line. */
  expectedStatus?: number;
  /** Human-readable label echoed in the section banner + assertion message. */
  label?: string;
  /** Section number, e.g. '9z-AH'. Defaults to '9z-XX' placeholder. */
  sectionNumber?: string;
  /** Step number within the section. Defaults to 1. */
  sectionStep?: number;
}

const METHODS_WITHOUT_BODY = new Set(['GET', 'DELETE']);

/**
 * Escape embedded single quotes for a PowerShell single-quoted string
 * (the convention is to double the quote).
 */
function escapePsSingleQuoted(input: string): string {
  return input.replace(/'/g, "''");
}

function bodyHasContent(body: unknown): boolean {
  if (body === undefined || body === null) return false;
  if (typeof body === 'string') return body.length > 0;
  if (Array.isArray(body)) return body.length > 0;
  if (typeof body === 'object') return Object.keys(body as Record<string, unknown>).length > 0;
  return true;
}

export function emitLiveTestSnippet(args: LiveTestSnippetArgs): string {
  const section = args.sectionNumber ?? '9z-XX';
  const step = args.sectionStep ?? 1;
  const label = args.label ?? `${args.method} ${args.path}`;
  const expected = args.expectedStatus ?? 200;
  const banner = `# ${section}.${step}: ${label}`;

  const includeBody = !METHODS_WITHOUT_BODY.has(args.method) && bodyHasContent(args.body);

  // Render the body as a single-quoted JSON literal piped through
  // ConvertTo-Json (round-trips via ConvertFrom-Json so deep nesting
  // works without PowerShell hashtable syntax). The single-quoted
  // wrapper preserves all JSON escaping; we double-up embedded single
  // quotes per PowerShell semantics.
  const lines: string[] = [];
  lines.push(banner);

  if (includeBody) {
    const json = JSON.stringify(args.body, null, 2);
    const escaped = escapePsSingleQuoted(json);
    // ConvertFrom-Json + ConvertTo-Json round-trip: gives us a
    // canonical single-line JSON body that PowerShell can hand off to
    // -Body verbatim. Matches the style used elsewhere in
    // scripts/live-test.ps1 (see e.g. line 1318+).
    lines.push(`$body = '${escaped}' | ConvertFrom-Json | ConvertTo-Json -Depth 10`);
  }

  // Use Invoke-WebRequest so we can assert the status code via
  // [int]$response.StatusCode (matches the pattern used by
  // 9z-AG / 9z-Q.7a / 9z-J.4 sections).
  const callParts = [
    `$response = Invoke-WebRequest -Uri "$baseUrl${args.path}"`,
    `-Method ${args.method}`,
    '-Headers $headers',
  ];
  if (includeBody) {
    callParts.push('-Body $body');
    callParts.push("-ContentType 'application/scim+json'");
  }
  callParts.push('-ErrorAction Stop');
  lines.push(callParts.join(' `\n  '));

  // Assertion line.
  const escapedLabel = escapePsSingleQuoted(label);
  lines.push(
    `Test-Result -Success (${expected} -eq [int]$response.StatusCode) -Message '${section}.${step}: ${escapedLabel} returns ${expected}'`,
  );

  return lines.join('\n');
}
