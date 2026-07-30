# Self-Audit - 2026-07-30

Scope: the `RfcCompliantSubAttributes` build (v0.54.0-alpha.12). Produced per
the R7 self-improvement rule and the Design & Architecture gate, which require
every change to end with an explicit disposition: **applied**, **scheduled**, or
**accepted**.

---

## 1. What this build revealed that the gate set did not cover

### F1 - APPLIED: a flag's diagnostics can name the wrong flag, and no API-level gate could see it

**What happened.** The R1 nesting rejection was enforced in two places: inside
the strict validator (when `StrictSchemaValidation` was on) and in a standalone
pass (when it was off). Both produced the correct 400, so every unit and E2E
test passed. But the *attribution* differed: the strict path reported
`triggeredBy: "StrictSchemaValidation"`, which is actively misleading, because
turning strict off does not lift the rejection. An operator reading that
diagnostic would flip a switch that cannot fix their problem.

**Why every existing gate missed it.** Each API-level test exercised exactly one
strict setting, and `triggeredBy` was only asserted on the lenient path. A
matrix of correct-looking single-axis tests can leave a whole quadrant
unasserted. The Playwright spec caught it because it was the first test that
drove the *default* configuration (strict on) through the *user's* path.

**Disposition: APPLIED, in the same commit chain.**
- Enforcement collapsed to ONE private `enforceSubAttributeNesting` per service,
  running before the strict branch, so there is one decision and one attribution.
- E2E now asserts `triggeredBy` AND `activeConfig` on the strict-ON path.

**Generalizable rule proposed for `copilot-instructions.md`:** when a change adds
a flag that interacts with an existing flag, the test matrix MUST cover the full
cross-product of the two flags, and MUST assert the *diagnostics attribution* in
every cell, not only the status code. A correct status with the wrong
`triggeredBy` is a defect, because the diagnostics envelope is the operator's
only pointer to the control that governs the behavior.

### F2 - APPLIED: a live-test section that aborts on first failure hides every later assertion

`9z-AT` indexed into the diagnostics envelope without a guard. When the section
was run against a build lacking the feature (the negative control), the first
mismatch threw `Cannot index into a null array`, aborting the section and
reporting a single generic error instead of the five assertions that had
genuinely failed. A gate that collapses on first contact reports far less than
it knows.

**Disposition: APPLIED.** Added a guarded `Get-AtDiag` accessor so every
assertion reports independently.

### F3 - APPLIED (process): a new gate must be proven able to fail

`9z-AT` was run against an untouched `master` build, where it fails 6 of 11.
Without that, a green section is indistinguishable from a section that cannot
detect the feature's absence. This is now the second time in this repo that a
negative control has paid for itself (the first was `scripts/test-sync-rfcs.ps1`,
8/8 cases).

**Disposition: APPLIED as practice.** Proposed for promotion to a standing rule:
any NEW live-test section or gate script MUST be demonstrated RED against a build
without the feature before its green result is trusted.

---

## 2. Scheduled follow-ups

### S1 - SCHEDULED: `visual-regression.spec.ts` "Endpoint detail - Schemas tab" is dataset-coupled

**Finding.** The test navigates to `/endpoints`, clicks *whichever endpoint card
happens to be first*, and screenshots the Schemas tab full-page. The schema
cards below `schemas-tree` are not masked, so the baseline encodes the schema
content of one arbitrary endpoint in one environment at one moment. It failed on
dev and on two different local datasets in this session, with layout
pixel-identical in every diff. It also failed on the untouched-master control
run, so it is pre-existing and not caused by this change.

**Why it was NOT fixed here.** Regenerating the baseline would re-encode today's
dev dataset and break again on the next data change - the R3 discipline says
investigate before regenerating, and the investigation says the spec design is
the defect, not the pixels.

**Proposed fix.** Either (a) have the test create its own deterministic
throwaway endpoint with a known schema set, delete it afterwards, and screenshot
that - the pattern `profile-enforcement-ui.spec.ts` and the new
`rfc-compliant-subattributes-flag.spec.ts` already use; or (b) mask the schema
card region as well, which keeps the chrome under regression control while
dropping the data coupling. Option (a) is preferred because it preserves real
coverage.

**Owner:** UI workstream. **Target:** next visual-regression touch.

### S2 - SCHEDULED: local Playwright runs need a seeded endpoint

**Finding.** A full Playwright run against a *pristine* local server produced 38
failures. Root cause, measured: with no endpoints, the onboarding modal is open
and its Fluent `DialogSurface` backdrop intercepts pointer events, so every
`app-shell` click times out. Seeding one endpoint took `keyboard-nav` from 8
failed to 8/8 and the suite from 38 failures to 3. None of this was visible from
the failure names, which all looked like unrelated UI breakage.

This is a trap that will cost the next person the same hour, and it is
particularly dangerous because 38 red tests *look* like a real regression.

**Proposed fix.** Add a Playwright global-setup that ensures at least one
endpoint exists before the suite runs (creating a throwaway one if not), so the
local, Docker and dev form factors start from the same UI state. Alternatively,
dismiss the onboarding modal in the shared `fixtures.ts` `authenticated` fixture.

**Owner:** UI workstream. **Target:** next `web/e2e` touch.
Recorded in repo memory so it is not re-discovered from scratch.

---

## 3. Design and architecture gate disposition

Run against the change per the mandatory 7-point gate.

| # | Check | Finding | Disposition |
|---|---|---|---|
| 1 | **SRP** | `scim-service-helpers.ts` is already a large shared-helpers file. This change ADDED a method, but it also removed a 30-line inline block from `validatePayloadSchema`, so that method got smaller and single-purpose. No new god-class pressure. | accepted |
| 2 | **Coupling** | The domain validator stays framework-free: it exposes `validateSubAttributeNesting` and knows nothing about endpoint config. The flag is read at the service boundary and passed down as a plain `ValidationOptions` field. No new coupling between the config registry and the domain layer. | accepted |
| 3 | **Pattern consistency** | Follows the established flag pattern (registry constant + definition + `getConfigBoolean` at the service boundary + Switch in `SettingsTab` + live-test section). The one deviation is deliberate: enforcement runs BEFORE the strict branch rather than inside it, which is what makes attribution correct. | accepted, documented |
| 4 | **Open/Closed** | The two rules are enforced by two small predicates rather than a growing `switch`. A third sub-attribute rule would add a predicate, not edit a cascade. No strategy seam needed yet. | accepted |
| 5 | **Simplicity (YAGNI)** | Considered and REJECTED: (a) splitting into two flags, one per rule - the operator explicitly asked for one, and the two rules are two halves of the same RFC question; (b) a `SubAttributeRuleStrategy` seam - there is exactly one implementation and no second on the horizon, so it would be speculative generality; (c) schema-registration-time validation - would make existing schemas unloadable after the flag is turned on, which is a worse failure mode than payload-time rejection. | rejected as over-engineering, with reasons |
| 6 | **Duplication** | The Users/Groups path and the custom-resource-type path each have their own `enforceSubAttributeNesting`. This is duplication (~30 lines) and was a conscious trade: the two differ in how they resolve schemas and attribute maps (`buildSchemaDefinitions` + `getSchemaCache` vs `buildSchemaDefinitionsFromPayload` + `getAttrMapsForRT`), and they already sit either side of an established seam. Unifying them means introducing a schema-resolution abstraction across two services, which is a larger refactor than this change should carry. The RISK - the twins drifting - is mitigated because both delegate the actual rule and the error text to a single `SchemaValidator` builder, so only the plumbing is duplicated, never the decision. | accepted, with mitigation |
| 7 | **Promote** | F1 has one high-severity sighting (a shipped-but-misleading diagnostic). Under the promotion rule a single high-severity escape qualifies for promotion to a hard rule. Recommended addition to `copilot-instructions.md` Stage 3a: *flag-interaction matrix coverage, including diagnostics attribution in every cell*. | proposed for the next instructions update |

---

## 4. Escape analysis

| Finding | Caught by | Earliest gate that could have | Escape delta |
|---|---|---|---|
| F1 misattributed `triggeredBy` | Playwright (Stage 5.3) | API E2E (Stage 2.2) - a strict-ON assertion on `triggeredBy` | 3 stages |
| F2 live section aborts on first failure | negative control run | authoring the section (Stage 0) | 1 stage |
| S1 dataset-coupled visual baseline | Stage 5.3 vs dev | spec authoring | pre-existing |
| S2 onboarding modal blocks local runs | Stage 5.3 local | never - no gate models "pristine server" | uncovered until now |

The F1 delta of three stages is the significant one, and it is the direct
justification for the promotion proposed in row 7 above.
