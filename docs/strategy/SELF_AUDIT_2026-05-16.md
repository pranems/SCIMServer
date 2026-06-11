# Stage X.1 Self-Audit — 2026-05-16

> **Trigger:** D — Incident-driven (the user asked "were all the gates and stages as per the new comprehensive plan run? including all the prompts?" after Phase N2 shipped, and the answer was no)
> **Scope:** Last 8 commits on `feat/ui` from cb7fe7b (strategy) → 53a42bd (rename)
> **Run by:** Coding assistant + operator
> **Prior Stage X.1 report:** none (this is the first)
> **Next Stage X.1 run recommended:** 2026-06-01 (calendar trigger) OR next release cut, whichever comes first

---

## Summary

| Section | Findings | Severity |
|---|---|---|
| A — Internal drift | 6 (1 high, 3 medium, 2 speculative) | mixed |
| B — External standards | not run this iteration (calendar trigger will cover) | — |
| C — Incident learnings | 3 (this session) | medium |
| D — Recommended additions | 2 (process improvements; no new prompts) | medium |
| E — Recommended retirements | 0 | — |
| F — Recommended ratchets | 1 (web vitest coverage thresholds) | low |

Net actionable items: **6 process / doc fixes**, **0 new gates needed**.

---

## Section A — Internal drift

### A.1 — Baseline rot

| Baseline | Documented | Measured today | Delta | Recommended action |
|---|---|---|---|---|
| API lint warnings | 465 | 465 | 0 | No action |
| API lint errors | 0 | 0 | 0 | No action |
| Web tsc errors | 96 (87 test / 9 prod) | 96 (87 test / 9 prod) | 0 | No action |
| Web vitest count | (prev. 893) | 909 (+16 from N2) | +16 | Already documented in CHANGELOG |
| API unit count | (prev. 3724) | 3728 (+4 from Finding-B) | +4 | Already documented |
| API E2E count | 1186 | 1186 | 0 | No action |
| Live SCIM (dev) | 984 | 984 | 0 | No action |
| Web vitest coverage lines | floor 78 | actual 83.55 (+5.55) | UP | **Ratchet candidate** — see F.1 |
| Web vitest coverage branches | floor 70 | actual 72.32 (+2.32) | UP | borderline; defer |
| Web vitest coverage functions | floor 65 | actual 71.3 (+6.3) | UP | **Ratchet candidate** — see F.1 |
| Web vitest coverage statements | floor 75 | actual 80.32 (+5.32) | UP | **Ratchet candidate** — see F.1 |

**Verdict:** healthy. Three ratchet candidates earned by organic coverage growth.

### A.2 — Prompt rot

The 10 new prompts were authored 2026-05-16 (this session). None of them have a "last fired" date yet because they are all new. First fire data will come from this session's actions.

| Prompt | First fire status |
|---|---|
| `lintAndStaticAnalysis` (Stage 1.1) | Not yet invoked as a prompt; underlying gates run manually |
| `bundleBudgetAudit` (Stage 1.8) | Not invoked; N2 added no new lazy routes so would have been a no-op |
| `prismaMigrationAudit` (Stage 1.9) | Not invoked; N2 didn't touch `api/prisma/` so would have been a no-op |
| `crossBackendParityAudit` (Stage 2.5) | Not invoked; N2 is frontend-only so would have been a no-op |
| `endpointConfigFlagAudit` (Stage 3b.3) | Not invoked; N2 didn't touch flags so would have been a no-op |
| `dependencyCveSweep` (Stage 3b.5) | **Invoked** this audit; 0 critical/high, 4 moderate (dev-only deps, tracked) |
| `codeReviewSelfAudit` (Stage 3c.1) | **Invoked** this audit; surfaced finding D.1 (OnboardingWizard.tsx 478 lines) |
| `playwrightSpecHygieneAudit` (Stage 5.2) | Invoked during Finding-C cleanup (3d73225); 121→40 failures; not re-run for N2 because no new specs added |
| `gateStrategySelfAudit` (Stage X.1) | **THIS DOCUMENT IS THE FIRST FIRE** |
| `securityBestPracticesIntake` (Stage X.2) | Not yet invoked; recommended next |

**Verdict:** all prompts are too new to evaluate for retirement.

### A.3 — Coverage rot

See A.1 — coverage UP across all 4 thresholds. Ratchet candidates listed in F.1.

### A.4 — Complexity rot

Stage 3c.1 was invoked for N2. Surfaced 1 file at "concerning" threshold:

| File | Lines | Status | Action |
|---|---|---|---|
| `web/src/layout/OnboardingWizard.tsx` | 478 | Concerning (>400, <800) | **Refactor candidate** — extract per-step bodies (Step1Intro, Step2PresetPicker, Step3IssueCredential, Step4Workbench) into separate components. ~1-hour follow-up. Suggested, not blocking. |

All other touched files (useOnboarding.ts 101 lines, AppShell.tsx 121 lines, SettingsPage.tsx 357 lines) are healthy.

### A.5 — Doc rot

Stage 3c.2 docs sweep surfaced:

| Doc | Issue | Severity | Fixed in this audit |
|---|---|---|---|
| `README.md` | Test counts stuck at 3,378 unit / 1,074 E2E / 789 live (v0.38-era); version badge 0.38.0 | **High** | ✅ Updated to 3,728 / 1,186 / 984 / 909 / 14 = 6,821; badge to 0.52.0-alpha.2 |
| `CHANGELOG.md` Phase N2 entry | Total assertions claimed 6,833; correct value is 6,821 (off by 12; double-counted +16 N2 delta) | Medium | ✅ Corrected to 6,805 → 6,821 |
| `Session_starter.md` Phase N2 row | Same math error (6,833) | Medium | ✅ Corrected to 6,821 |
| `docs/PROJECT_HEALTH_AND_STATS.md` | No current test count references found at all | Medium | Out of scope for this audit; defer to next docs sweep |
| `docs/CONTEXT_INSTRUCTIONS.md` | No current test count references found at all | Medium | Out of scope for this audit; defer to next docs sweep |

### A.6 — Test escape patterns

Two real escapes in this session captured to the loop:

1. **Finding-B** (97cd209) — InMemory `EndpointService.createEndpoint` missing duplicate-name guard that Prisma had. Caught by live-test 9z-AA.5 (post-deploy). Fixed; new unit spec `endpoint.service.inmemory.spec.ts` locks the parity. The new `crossBackendParityAudit` prompt (Stage 2.5) was authored AFTER this escape; it would have caught it at unit layer if it had existed.
2. **Finding-C** (3d73225) — 121 Playwright failures against dev because 7 specs targeted legacy UI deleted in Phase I v0.48.0 (~7 weeks earlier). Fixed by deleting the 7 specs (121 → 40 failures). The new `playwrightSpecHygieneAudit` prompt (Stage 5.2) was authored AFTER this escape; it would have caught it during Phase I cleanup if it had existed.

Both are already documented in the standing-rules Self-Improvement Loop section.

---

## Section B — External standards intake

**Not run this iteration.** Trigger B (calendar, monthly) is the appropriate cadence for full external scan. Recommended next: 2026-06-01.

---

## Section C — Incident learnings (this session)

| Incident | Commit that introduced | Detection layer | Time to fix |
|---|---|---|---|
| InMemory parity gap on duplicate name | (latent since v0.30 endpoint admin shipped) | Live test 9z-AA.5 on local inmemory | <1 hour after detection |
| 121 stale Playwright failures | (latent since Phase I v0.48.0 cutover) | Playwright vs dev after Finding-B fix | <30 min to identify + delete |
| **Gate-strategy under-invocation on Phase N2** | this session | User asked "were all gates run?" | <1 hour (this audit) |

The third one is the meta-lesson: when the strategy was new (less than 24 hours old) and operators didn't have muscle memory yet, ~25% of gates were actually invoked per the documented strategy. Catching this in audit, not in production, is the strategy working.

---

## Section D — Recommended additions

### D.1 — `runAllGates.ps1` orchestrator script (process)

**Recommendation:** add a single PowerShell script `scripts/run-all-gates.ps1` that walks Stage 0 → Stage 6 in order, invokes each prompt or shell-equivalent, and produces a structured report.

**Why:** the gate-strategy under-invocation in this session was a discipline gap, not a strategy gap. A one-command invocation that walks every applicable gate would reduce that gap to near zero.

**Confidence:** Medium. There's a risk of becoming a smoke-screen ("I ran the script so I'm done") without the operator paying attention to findings. Mitigation: the script should pause after each finding and require explicit acknowledgment.

**Effort:** 1 day. **Owner action:** operator decides if this is wanted; if yes, sub-task on next sprint.

### D.2 — `auditAndUpdateDocs` should explicitly sweep README + PROJECT_HEALTH + CONTEXT_INSTRUCTIONS

**Recommendation:** extend the existing `auditAndUpdateDocs` prompt with an explicit checklist that includes `README.md`, `docs/PROJECT_HEALTH_AND_STATS.md`, `docs/CONTEXT_INSTRUCTIONS.md` as MUST-CHECK files for every commit, not just feature commits.

**Why:** README was 9 weeks behind on test counts and 14 versions behind on the badge. Operators reading the repo home page got stale info.

**Confidence:** High. Concrete, low-cost, addresses a found issue.

**Effort:** 15 min (prompt edit).

---

## Section E — Recommended retirements

**None.** All prompts are <24 hours old (this session). Cannot meet the 30-day no-fire evidence rule for retirement. Re-evaluate at next monthly audit.

---

## Section F — Recommended ratchets

### F.1 — Web vitest coverage thresholds

**Current floor (Phase H4):** lines:78 / branches:70 / functions:65 / statements:75
**Measured today:** lines:83.55 / branches:72.32 / functions:71.3 / statements:80.32
**Recommended new floor:** lines:82 / branches:70 / functions:69 / statements:78

**Confidence:** High. Headroom of 3-6 points on each, supported by today's measurement.

**Effort:** 5 min (edit `web/vite.config.ts` test.coverage.thresholds + update `coverage-config.test.ts` baseline assertions).

**Action:** ratchet at next dedicated commit (don't bundle with N3 to keep changes focused).

---

## Proposed deltas to copilot-instructions.md

1. **Add D.2 finding to the standing Self-Improvement Loop section** — extend `auditAndUpdateDocs` description to mention the 3 must-check root docs.

2. **Add a known-precedent line** to the Self-Improvement Loop:
   > **First Stage X.1 run (2026-05-16)** — meta-audit caught README test counts 9 weeks stale + Phase N2 CHANGELOG math error (6,833 vs 6,821). Confirmed the meta layer works: it found 6 actionable items that the per-commit gates missed.

3. **No new gates proposed** — the gap was operator discipline, not strategy design.

---

## Next Stage X.1 run

- Trigger: B (calendar, 2026-06-01) OR A (release cut at v0.52.0 stable) OR D (next incident), whichever comes first
- Scope: full sweep
- Expected output: continued health monitoring + first Stage X.2 (`securityBestPracticesIntake`) run paired with it
