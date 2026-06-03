---
name: dependencyCveSweep
description: Run npm-audit / Snyk-style CVE scan against api/ and web/ dependencies, prioritize by severity, fail on Critical/High. Companion to securityAudit but with a different cadence (every dep bump + weekly).
argument-hint: Optional - "api" or "web" to scope to one tree; omit for both. Add "--fix" to apply automatic fixes via npm-audit-fix when safe.
---

This is the security-family companion to `securityAudit` focused exclusively on **third-party dependency CVEs**. Different from `securityAudit` in three ways:
1. **Cadence**: triggered by `package.json` / `package-lock.json` changes OR weekly schedule, not per-feature.
2. **Output**: a triaged CVE list with severity counts, not a free-form security review.
3. **Fix path**: dependency upgrade or replacement, not code change.

Both prompts run in Stage 3b (Cross-Cutting Audits). They cover different bug classes; run BOTH, not either-or.

---

## Step 1 - Scan api/ tree

```powershell
cd api
# 1.1 Native npm audit
npm audit --json 2>&1 | Set-Content -Path ../test-results/cve-api.json

# 1.2 Parse + categorize
$audit = Get-Content ../test-results/cve-api.json -Raw | ConvertFrom-Json
$audit.metadata.vulnerabilities | Format-Table info, low, moderate, high, critical, total -AutoSize

# 1.3 List Critical + High by package
if ($audit.vulnerabilities) {
    $audit.vulnerabilities.PSObject.Properties | Where-Object {
        $_.Value.severity -in 'critical', 'high'
    } | ForEach-Object {
        "{0,-30} severity={1,-8} via={2}" -f $_.Name, $_.Value.severity, ($_.Value.via -join ', ')
    }
}
```

---

## Step 2 - Scan web/ tree

```powershell
cd web
npm audit --json 2>&1 | Set-Content -Path ../test-results/cve-web.json
$audit = Get-Content ../test-results/cve-web.json -Raw | ConvertFrom-Json
$audit.metadata.vulnerabilities | Format-Table info, low, moderate, high, critical, total -AutoSize
```

---

## Step 3 - Apply the severity threshold gate

| Severity | Action |
|---|---|
| Critical | **BLOCK commit**. Must upgrade OR document explicit risk acceptance in CHANGELOG with a tracking issue. |
| High | **BLOCK commit unless dev-only dep AND no production code path exists**. Same documentation rule. |
| Moderate | Allow, but track in a running list. If unfixed > 30 days, escalate to High. |
| Low / Info | Allow, batch-fix during next dep bump cycle. |

The threshold is intentionally strict because:
- API dependencies run server-side with secrets in env. A High CVE in a server dep is exploitation-ready.
- Web dependencies bundle into the served JS. A High CVE in a UI dep gets cached on every operator browser.

---

## Step 4 - For each Critical/High, gather upgrade context

For each blocking CVE, fetch:
1. **CVE ID + CVSS score** from `npm audit` output.
2. **Patched version range** from `npm audit` (or `npm view <pkg> versions --json`).
3. **Direct vs transitive** - is the dep direct in `package.json` or pulled in by another package?
4. **Production vs dev** - `dependencies` vs `devDependencies` in `package.json`.

Output a triage table:

| CVE | Package | Severity | Direct? | Prod? | Patched in | Action |
|---|---|---|---|---|---|---|
| CVE-2026-1234 | lodash | High | No (via X) | Yes (X is prod) | >=4.17.22 | Upgrade X to vY which pulls patched lodash |
| ... | ... | ... | ... | ... | ... | ... |

---

## Step 5 - Apply fixes safely

```powershell
# 5.1 Safe automatic fixes (semver-compatible upgrades only)
cd api
npm audit fix
# Verify no regression: cd api; npm test
git diff package-lock.json | Select-Object -First 30

# 5.2 Major-version upgrades (requires explicit consent)
# DO NOT use `npm audit fix --force` without confirming with user.
# Major upgrades may have breaking changes. Read the package CHANGELOG first.
```

**After EVERY fix:** re-run Stage 1 (`lintAndStaticAnalysis`) + Stage 2 (`npm test` + E2E) + Stage 4 live tests. A "safe" semver bump can still break runtime behavior.

---

## Step 6 - Verify lockfile reproducibility

The standing rule (copilot-instructions.md Stage 6.1) requires lockfiles to be regenerated inside `node:25-alpine` for cross-platform CI reproducibility. After `npm audit fix`, run:

```powershell
docker run --rm -v "${PWD}:/app" -w /app node:25-alpine sh -c "cd api && rm -rf node_modules && npm ci && npm install"
docker run --rm -v "${PWD}:/app" -w /app node:25-alpine sh -c "cd web && rm -rf node_modules && npm ci && npm install"
```

Commit the regenerated lockfiles in the SAME commit as the CVE fix.

---

## Step 7 - Document in CHANGELOG + tracking

For every Critical/High CVE fixed:
```markdown
**Security:** Bumped `<package>` from `<old>` to `<new>` to fix `<CVE-XXXX-YYYY>` (CVSS X.Y, <severity>). No behavior change expected; full test suite green.
```

For every Critical/High CVE NOT fixed (risk-accepted):
```markdown
**Security (deferred):** `<CVE-XXXX-YYYY>` in `<package>` (severity <X>) is not fixable without breaking changes. Risk-accepted because: <reason>. Tracking: <issue-link>. Re-evaluate by <date>.
```

---

## Step 8 - Cross-link with securityAudit

If `securityAudit` is also being run in the same session:
- This prompt handles WHAT vulnerable deps exist.
- `securityAudit` handles WHETHER our code is misusing safe deps (auth bypasses, weak secrets, missing headers, OWASP Top 10).
- Both feed into Stage 3b cumulative results. Do not consider Stage 3b green if EITHER prompt reports unaddressed High/Critical findings.

---

## Outputs

When this prompt completes, produce:
1. Severity matrix for api/ and web/ (Step 1-2 outputs).
2. Triage table for every Critical/High (Step 4).
3. List of fixes applied (Step 5).
4. List of risk-accepted CVEs with rationale (Step 7).
5. CHANGELOG entry text ready to paste.

---

## When to run this prompt

- **MANDATORY**: Whenever `api/package.json`, `api/package-lock.json`, `web/package.json`, or `web/package-lock.json` is in the staged diff.
- **MANDATORY**: Weekly on a schedule (CVE DB updates continuously even when our deps don't move).
- **MANDATORY**: Before any prod promotion (the deployAndPromote prompt should invoke this as a sub-gate).
- **OPTIONAL**: As part of any `securityAudit` run.
