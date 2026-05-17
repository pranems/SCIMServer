---
name: gateStrategySelfAudit
description: Meta-prompt - introspect the gate strategy itself plus external best-practice intake. Looks for missing gates BEFORE bugs escape, retires dead prompts, ratchets baselines, intakes RFC/framework/security advisory updates. Lives in Stage X (Meta).
argument-hint: Optional - "--scope=lastNcommits=N" (introspect last N commits), "--scope=currentRelease" (last alpha/stable cycle), "--scope=fullSweep" (entire repo + prompt library), "--scope=incident" (focused on a recent bug escape; specify --commit=<sha>).
---

This is a META prompt. It does not gate any commit. It does not run per-feature. It runs on inflection points to evolve the gate strategy itself.

The repo has a "Gate-Strategy Self-Improvement Loop" section in [.github/copilot-instructions.md](../../.github/copilot-instructions.md). Today that section is updated REACTIVELY (after a bug escapes, the corresponding gate is added). This prompt is the formal engine that makes the loop PROACTIVE: look for missing gates BEFORE bugs escape, surface drift, intake external standards changes.

It is the most expensive prompt in the library by far. The trade is: occasional deep introspection vs continuous bug-escape-then-react. The former compounds; the latter doesn't.

---

## Trigger conditions (when to run this prompt)

| Trigger | Cadence | Scope | Rationale |
|---|---|---|---|
| **A. Release cuts** | Every `v0.X.0` stable rollup | last release cycle | Natural reflection point; matches release rhythm |
| **B. Calendar** | Monthly (1st of month) | full sweep | Catches drift in periods without release |
| **C. On-demand** | User invokes | operator-specified | Bug-hunt / planning mode |
| **D. Incident-driven** | After ANY bug escapes Stages 1-5 to live/dev | focused on the escape path | Auto-captures Finding-B / Finding-C class events into the loop |

If invoked with no scope flag, default is `--scope=lastNcommits=20`.

---

## Hard constraints (must follow)

1. **External claims require URL citations.** Any "RFC X added Y" or "Framework Z deprecated W" claim MUST include the URL. No URL = "speculative — verify before action."
2. **Confidence levels required.** Every finding marked High / Medium / Speculative.
3. **Owner action required.** Every finding lists a concrete next step. Bare "this seems off" findings are not allowed.
4. **2-escape threshold for new prompts.** Do NOT recommend a new prompt unless there are >=2 historical bug-escape patterns that the new prompt would catch. Single-escape patterns go into an EXISTING prompt as a new check.
5. **No prompt retirement without 30+ days of no-fire evidence.** A prompt that hasn't surfaced a finding in 30 days might just be working (deterrent effect). Require explicit historical-no-value evidence.
6. **No baseline ratchet without a measured snapshot.** Recommending "tighten the lint warning ceiling from 465 to 400" requires `npm run lint` measured today AND the tighten amount must be supported by the measurement.

---

## Section A - Internal drift

### A.1 - Baseline rot

Compare the documented baselines against today's measurements:

```powershell
# Lint warnings
$apiLint = npm --prefix api run lint 2>&1
"API lint: $((($apiLint | Select-String 'error').Count)) errors, $((($apiLint | Select-String 'warning').Count)) warnings vs documented 0/465"

# Web tsc errors
cd web
$webTsc = (npx tsc --noEmit 2>&1 | Select-String 'error TS').Count
"Web tsc: $webTsc errors vs documented 96"

# Test counts
"API unit: actual=$apiUnitCount documented=3724"
"API E2E: actual=$apiE2eCount documented=1186"
"Web vitest: actual=$webVitestCount documented=893"
"Live dev: actual=$liveDevCount documented=984"
```

For each baseline:
- **Drift > 5% UP** in lint warnings / tsc errors / failure counts -> RECOMMENDED ACTION: identify culprit commits, file regression fixes.
- **Drift DOWN** by >5% in test counts -> RECOMMENDED ACTION: re-audit deleted tests, ensure deletion was intentional (legacy spec hygiene) not accidental (regression).
- **Drift > 0 but < 5%** -> note in CHANGELOG but no action.

### A.2 - Prompt rot

For each `.github/prompts/*.prompt.md`:
- Last fired on (search Session_starter / CHANGELOG / commit history for prompt name).
- Last bug-class it found (parse "fix:" commits from since last run).
- Days since last finding.

| Prompt | Last fired | Last finding | Days since |
|---|---|---|---|
| `addMissingTests` | <date> | <commit> | <N> |
| ... | ... | ... | ... |

Findings:
- **Last finding > 90 days ago** -> CANDIDATE for retirement. Mark candidate, require 30 more days of no-fire before retiring.
- **Last finding < 7 days ago** -> earning its cost; do not touch.

### A.3 - Coverage rot

Compare web vitest coverage (Phase H4 thresholds: lines:78 / branches:70 / functions:65 / statements:75) against today's measurement:

```powershell
cd web; npm run test:coverage 2>&1 | Select-String -Pattern 'lines|branches|functions|statements' | Select-Object -First 5
```

- **Actual > floor by >5%** -> RECOMMENDED ACTION: ratchet the floor up. This is how the Phase H4 ratchet stays meaningful.
- **Actual < floor** -> coverage gate is broken. Identify regression-source commits.

### A.4 - Complexity rot

Find the top 10 files by line count growth in the scope window:

```powershell
git log --since='30 days ago' --pretty=format:'%H' -- 'api/src/**/*.ts' 'web/src/**/*.ts' | Select-Object -First 1 | ForEach-Object {
    git diff --shortstat HEAD~30 HEAD -- 'api/src/**/*.ts' 'web/src/**/*.ts'
}
git diff HEAD~30 HEAD --numstat -- 'api/src/**/*.{ts,tsx}' | Sort-Object { [int]($_ -split '\s+')[0] } -Descending | Select-Object -First 10
```

- **Any file grew by >300 lines in 30 days** -> RECOMMENDED ACTION: trigger `codeReviewSelfAudit` on that file in next commit.
- **Any file crossed 1000 lines** -> CRITICAL. Refactor candidate.

### A.5 - Doc rot

Find docs whose mtime is > 60 days old AND whose related code has been modified since:

```powershell
Get-ChildItem docs/ -Filter '*.md' -Recurse | ForEach-Object {
    $docMtime = $_.LastWriteTime
    if ($docMtime -lt (Get-Date).AddDays(-60)) {
        # Heuristic: filename hints at feature area (e.g., G8E_RETURNED -> RETURNED filter)
        # Check if any related code changed since the doc's mtime.
        "STALE? {0,-50} last={1:yyyy-MM-dd}" -f $_.Name, $docMtime
    }
}
```

- **Stale + related-code-modified** -> RECOMMENDED ACTION: trigger `auditAndUpdateDocs` on that doc.

### A.6 - Test escape patterns

Parse CHANGELOG "fix:" entries in the scope window. For each:
- What gate SHOULD have caught it? (parse the standing-rule list)
- Was the gate run? (cross-check the commit that introduced the bug)
- If the gate exists and was run but missed it -> the gate is broken; recommend a check addition.
- If the gate exists but was not run -> CI/process gap; recommend automation.
- If no gate exists -> RECOMMENDED ACTION: candidate for a new gate or extension.

---

## Section B - External standards intake (with URL citations REQUIRED)

### B.1 - SCIM RFC updates

Check:
- [RFC 7643](https://datatracker.ietf.org/doc/rfc7643/) errata page since last run.
- [RFC 7644](https://datatracker.ietf.org/doc/rfc7644/) errata page since last run.
- IETF SCIM working group for RFC 7643bis / 7644bis drafts.

For each update found, cross-reference: does our test suite cover the new/changed behavior?

### B.2 - Framework upgrades

Check release notes for:
- **NestJS** ([github.com/nestjs/nest/releases](https://github.com/nestjs/nest/releases)) — breaking changes? new patterns?
- **Fluent UI** ([github.com/microsoft/fluentui/releases](https://github.com/microsoft/fluentui/releases)) — v9 → v10 migration patterns?
- **TanStack Router** ([github.com/TanStack/router/releases](https://github.com/TanStack/router/releases))
- **Vite** ([github.com/vitejs/vite/releases](https://github.com/vitejs/vite/releases))
- **Prisma** ([github.com/prisma/prisma/releases](https://github.com/prisma/prisma/releases))

For each new major / minor release in the scope window:
- New features that match a gap in our codebase?
- Deprecations that affect our code?
- Performance improvements worth adopting?

### B.3 - Security advisories

- [GitHub Security Advisory DB](https://github.com/advisories) for our dep list (overlap with `dependencyCveSweep`).
- [OWASP Top 10](https://owasp.org/www-project-top-ten/) for category shifts (e.g. A10:2021 SSRF gained focus).
- [Microsoft Security Response Center](https://msrc.microsoft.com/) advisories for Azure Container Apps.

### B.4 - SCIM ecosystem changes

- Okta, Auth0, Ping, Microsoft Entra ID SCIM client behavior changes (release notes, support docs).
- Major SCIM client interop test results published since last run.

---

## Section C - Incident learnings

Auto-pull every commit since the last run whose message starts with `fix:` or `feat: ... [hotfix]`. For each:

| Commit SHA | Date | Bug class | Gate that should have caught it | Gate that DID catch it | Time to detection | Time to fix |
|---|---|---|---|---|---|---|

Recurring patterns in this table are the strongest source of new-gate recommendations.

---

## Section D - Recommended additions

Aggregate findings from Sections A-C into:

| Finding | Recommendation | Confidence | Owner action |
|---|---|---|---|
| 3 inmemory-vs-prisma escapes in last 60 days | Extend `crossBackendParityAudit` with auto-detection of new `isInMemoryBackend` branches in CI | High | Add to Stage 2.5 |
| ... | ... | ... | ... |

Each recommendation must answer: WHICH stage does it belong to (1-6 + M), WHICH existing prompt does it extend or replace, and what's the cost of running it.

---

## Section E - Recommended retirements

Prompts that:
- Haven't fired in >60 days
- Cover responsibility that another newer prompt now subsumes
- Have a cost > value ratio

| Prompt | Last finding | Cost (run time + cognitive) | Value (bugs caught) | Recommendation |
|---|---|---|---|---|

---

## Section F - Recommended ratchets

Baselines that the code has earned:

| Baseline | Documented | Measured today | Recommended new value | Justification |
|---|---|---|---|---|
| API lint warnings | 465 | 442 | 442 | Locked in 23 cleanup wins; ratchet floor |
| Web vitest coverage lines | 78 | 82.4 | 82 | Coverage organically improved; ratchet |
| ... | ... | ... | ... | ... |

---

## Outputs

Produce a structured Markdown report under `docs/strategy/SELF_AUDIT_<YYYY-MM-DD>.md` containing:
1. Section A internal-drift table
2. Section B external-standards table (with URLs)
3. Section C incident-learnings table
4. Section D recommended-additions table (with confidence + owner)
5. Section E recommended-retirements table
6. Section F recommended-ratchets table
7. Summary at top: # of High-confidence findings; recommended NEXT meta-audit date.

Then propose updates to [.github/copilot-instructions.md](.github/copilot-instructions.md) Gate-Strategy Self-Improvement Loop section to record the deltas.

---

## When NOT to run this prompt

- **DO NOT** run per-commit. Cost too high; signal too noisy.
- **DO NOT** run on first-week-of-development codebases. Insufficient signal to compare against.
- **DO NOT** run when the operator is in tight feedback loop on a single bug. Use other Stage 1-5 prompts instead.

---

## Cost-vs-value calibration

Expected runtime: 20-60 minutes (deep introspection, external URL fetches, ratcheting calculations).

Expected value per run: 3-10 actionable findings, of which 1-3 typically result in a new gate / prompt extension / retirement.

ROI breaks even at: 1 escape-pattern caught proactively per 4 runs. Real-world precedents (Finding-B inmemory parity, Finding-C Playwright spec rot) suggest the actual hit rate is higher.
