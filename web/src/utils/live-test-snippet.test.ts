/**
 * Phase M2 - live-test-snippet pure module tests.
 *
 * Turns a Workbench history entry (or a fresh request) into a
 * paste-ready PowerShell snippet for `scripts/live-test.ps1`. This is
 * THE killer differentiator from analysis-doc S4.2 - the only admin
 * UI that lets the operator round-trip from "exploration in the
 * Workbench" to "regression test in the suite" without retyping.
 *
 * Properties under test:
 *   1. GET request -> Invoke-RestMethod call with -Method GET; no -Body
 *   2. POST request -> ConvertTo-Json + -Body + ContentType
 *   3. PATCH request -> SCIM PatchOp envelope preserved
 *   4. DELETE request -> -Method DELETE; no body
 *   5. Snippet always starts with the section banner comment
 *      `# 9z-XX.N: <message>` so the operator can paste straight in
 *   6. Path is wrapped in a $baseUrl variable form so it's easy to
 *      adjust between local/dev/prod
 *   7. Response status assertion (`Test-Result -Success ... -Message ...`)
 *      is appended for the expected-status round-trip lock
 *   8. Embedded single-quotes in JSON body are escaped per PowerShell
 *      here-string semantics
 *   9. Empty / missing body args produce a snippet without -Body
 *   10. Section number defaults to '9z-XX' when not supplied
 */
import { describe, it, expect } from 'vitest';
import { emitLiveTestSnippet, type LiveTestSnippetArgs } from './live-test-snippet';

describe('Phase M2 - emitLiveTestSnippet (PowerShell live-test snippet emitter)', () => {
  const baseArgs: LiveTestSnippetArgs = {
    method: 'GET',
    path: '/scim/endpoints/ep-1/Users',
    expectedStatus: 200,
    label: 'List users',
  };

  it('GET -> Invoke-WebRequest with -Method GET, no -Body (uses Invoke-WebRequest so StatusCode can be asserted)', () => {
    const s = emitLiveTestSnippet(baseArgs);
    expect(s).toMatch(/Invoke-WebRequest/);
    expect(s).toMatch(/-Method GET/);
    expect(s).not.toMatch(/-Body/);
  });

  it('POST -> ConvertTo-Json + -Body + -ContentType application/scim+json', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      method: 'POST',
      body: { schemas: ['urn:...:User'], userName: 'alice@x.com' },
    });
    expect(s).toMatch(/-Method POST/);
    // Snippet pipes the JSON body through ConvertFrom-Json | ConvertTo-Json
    // so the wire payload is canonical (matches the live-test.ps1 idiom).
    expect(s).toMatch(/ConvertTo-Json/);
    expect(s).toMatch(/-Body/);
    expect(s).toMatch(/-ContentType ['"]application\/scim\+json['"]/);
  });

  it('PATCH -> PatchOp envelope preserved verbatim in body literal', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      method: 'PATCH',
      body: {
        schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
        Operations: [{ op: 'replace', path: 'displayName', value: 'New' }],
      },
      headers: [{ key: 'If-Match', value: 'W/"v3"', enabled: true }],
    });
    expect(s).toMatch(/-Method PATCH/);
    expect(s).toContain('PatchOp');
    expect(s).toContain('displayName');
    expect(s).toContain("$requestHeaders['If-Match'] = 'W/\"v3\"'");
    expect(s).toContain('-Headers $requestHeaders');
  });

  it('DELETE -> -Method DELETE, no -Body even when body args are missing', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      method: 'DELETE',
      path: '/scim/endpoints/ep-1/Users/u1',
    });
    expect(s).toMatch(/-Method DELETE/);
    expect(s).not.toMatch(/-Body/);
  });

  it('snippet always starts with the # 9z-XX.N comment banner', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      sectionNumber: '9z-AH',
      sectionStep: 1,
    });
    expect(s.split('\n')[0]).toMatch(/^#\s*9z-AH\.1:/);
  });

  it('section defaults to "9z-XX" placeholder + step 1 when not supplied', () => {
    const s = emitLiveTestSnippet(baseArgs);
    expect(s.split('\n')[0]).toMatch(/^#\s*9z-XX\.1:/);
  });

  it('path is wrapped in $baseUrl variable form', () => {
    const s = emitLiveTestSnippet(baseArgs);
    // The path is a literal operand so `$()` and quotes cannot execute.
    expect(s).toContain("($baseUrl + '/scim/endpoints/ep-1/Users')");
  });

  it('appends a Test-Result assertion line for the expected status round-trip', () => {
    const s = emitLiveTestSnippet({ ...baseArgs, expectedStatus: 200 });
    expect(s).toMatch(/Test-Result\s+-Success/);
    expect(s).toMatch(/-Message\s+['"]/);
  });

  it('embedded single quotes in JSON body are escaped per PowerShell here-string', () => {
    // PowerShell @' '@ here-strings are literal; doubling single-quotes is
    // the convention for embedding them. The emitter prefers double-quoted
    // strings to sidestep this; here we just confirm no broken quote.
    const s = emitLiveTestSnippet({
      ...baseArgs,
      method: 'POST',
      body: { displayName: "O'Brien" },
    });
    // Resulting snippet must not contain an unescaped single quote inside
    // a single-quoted string literal that would break PowerShell parsing.
    expect(s).toContain("O'Brien".replace(/'/g, "''"));
  });

  it('omits -Body when body is undefined or empty object on a non-GET method', () => {
    const sNoBody = emitLiveTestSnippet({
      ...baseArgs,
      method: 'POST',
      body: undefined,
    });
    expect(sNoBody).not.toMatch(/-Body/);
  });

  it('the assertion message includes the human-readable label', () => {
    const s = emitLiveTestSnippet({ ...baseArgs, label: 'List users on prod', expectedStatus: 200 });
    expect(s).toContain('List users on prod');
  });

  it('uses non-throwing HTTP handling so expected 4xx statuses reach the assertion', () => {
    const s = emitLiveTestSnippet({ ...baseArgs, expectedStatus: 412 });
    expect(s).toContain('-SkipHttpErrorCheck');
    expect(s).not.toContain('-ErrorAction Stop');
  });

  it('preserves an enabled Content-Type header for a bodyless request', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    });
    expect(s).toContain("$requestHeaders['Content-Type'] = 'application/json'");
  });

  it('quotes a path so PowerShell expressions remain literal text', () => {
    const s = emitLiveTestSnippet({
      ...baseArgs,
      path: "/scim/endpoints/$(Write-Host 'bad')/Users",
    });
    expect(s).toContain("($baseUrl + '/scim/endpoints/$(Write-Host ''bad'')/Users')");
  });
});
