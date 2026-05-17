---
name: codeReviewSelfAudit
description: SOLID / DRY / readability / complexity hygiene audit of CHANGED files only. Suggestions, not blocks. Catches god-class growth, helper-bloat, naming drift that the RFC/security/perf prompts don't see.
argument-hint: Optional - "--scope=staged" (default, only staged files), "--scope=lastCommit" (HEAD diff), or "--scope=file:<path>" (one specific file).
---

This prompt fills a gap the other Stage 3 prompts don't cover. They check correctness against external standards (RFC, security, perf), behavior against contracts, completeness against feature lists. None of them check whether the CODE ITSELF is well-shaped.

Real precedents from the May 2026 Design Deep Analysis:
- `SchemaValidator` god class: 1,467 lines, multiple responsibilities, hard to test in isolation.
- `service-helpers.ts`: 1,230 lines of Swiss army knife methods loosely related.
- Generic service re-implements ~350 lines of logic that lives in `ScimSchemaHelpers`.
- Controller boilerplate triplicated across Users/Groups/Generic.
- Patch engine triplicated.

None of these are bugs by any unit test. All are real cost — maintainability cost, onboarding cost, regression-risk cost. This prompt surfaces them.

**Scope is intentionally tight.** This prompt audits CHANGED files only (staged or last-commit), not the whole codebase, because:
1. Full-repo audits produce hundreds of suggestions nobody actions.
2. Touch-point audits produce ~5-20 suggestions on this commit's surface, all relevant.
3. The relevant signal is "this change made the file worse" not "this file has historical debt."

**Output is suggestions, not blocks.** Differs from every other Stage 3 prompt for that reason. Code-shape is a craft judgment, not a contract violation. A bad suggestion costs more to argue with than to ignore, so the suggestions must be high signal.

---

## Step 1 - Enumerate scope

```powershell
# Default: staged files
$files = git diff --cached --name-only --diff-filter=AM | Where-Object { $_ -match '\.(ts|tsx)$' -and $_ -notmatch '\.(spec|test)\.tsx?$' }

# Or --scope=lastCommit
# $files = git diff --name-only HEAD~1 HEAD -- '*.ts' '*.tsx'

# Or --scope=file:<path>
# $files = @('<path>')

"Auditing $($files.Count) file(s):"; $files
```

If the scope is zero files (e.g. only test or doc changes staged), this prompt is N/A for this commit.

---

## Step 2 - For each file, measure shape

For each file in scope, compute:

| Metric | Healthy range | Concerning | Critical |
|---|---|---|---|
| Total lines | < 400 | 400 - 800 | > 800 |
| Largest function | < 60 | 60 - 120 | > 120 |
| Exported symbols | < 10 | 10 - 25 | > 25 |
| `if (this.isInMemoryBackend)` branches | 0 - 2 | 3 - 5 | > 5 (call `crossBackendParityAudit`) |
| Cyclomatic complexity per function (rough proxy: count `if/else/case/catch/&&/\|\|`) | < 10 | 10 - 20 | > 20 |
| Number of distinct responsibilities (judgment call) | 1 | 2 | 3+ |

```powershell
$files | ForEach-Object {
    $f = $_
    $lines = (Get-Content $f -ErrorAction SilentlyContinue).Count
    $exports = (Select-String -Path $f -Pattern '^export\s+' -ErrorAction SilentlyContinue).Count
    $inmemBranches = (Select-String -Path $f -Pattern 'isInMemoryBackend' -ErrorAction SilentlyContinue).Count
    "{0,-60} lines={1,5} exports={2,3} inmem={3}" -f $f, $lines, $exports, $inmemBranches
}
```

Files in the "Critical" column are surfaced regardless of whether the current change made them worse. Files in "Concerning" are surfaced only if the diff INCREASED any metric (raised line count by >50, added a >60-line function, added an exported symbol on top of an already-9-export file, etc.).

---

## Step 3 - Apply SOLID heuristics to the changed regions

For each changed region (`git diff <file>`), check:

### S — Single Responsibility
- Does the changed code add a NEW responsibility to the file, or extend an existing one?
- If new responsibility: should it live in a separate file?
- Example smell: `EndpointService.createEndpoint` was correctly Single Responsibility, then a PR added a side-effect that emits SSE events. The right shape: extract the emit to `EndpointEventEmitter`, inject it.

### O — Open/Closed
- Does the change require modifying existing behavior to add a new case (vs adding a new file)?
- Switch-statement growth is the canonical smell. If you added a new `case` to a switch you didn't author, ask: would a strategy/dispatcher be cleaner?

### L — Liskov Substitution
- Mostly relevant to repository implementations. If you added a new method to `PrismaXxxRepository`, is the same method on `InMemoryXxxRepository`? If not, callers can't substitute backends. (Calls `crossBackendParityAudit`.)

### I — Interface Segregation
- Did you add a method to an interface that only ONE caller uses?
- Smell: `IRepository.getInternalCacheKey()` — leaks impl details to an interface.

### D — Dependency Inversion
- New direct imports from concrete classes (vs from interfaces/types)?
- New `process.env.X` reads in business-logic files (vs in config files)?

---

## Step 4 - Apply DRY heuristics

For each new function/block, check:

| Question | Action |
|---|---|
| Does another file in `git grep` for the same logic produce hits? | Extract a shared helper. |
| Is this the 3rd time you've copy-pasted a try/catch envelope with the same shape? | Extract a wrapper function. |
| Are two service methods identical except for one constant? | Parameterize. |
| Does the new code re-implement a method already in `scim-service-helpers.ts`? | Use the helper. |

**Threshold for action:** 3 occurrences is the canonical DRY trigger. 2 is too aggressive (the abstraction often becomes wrong); 3 means the shape is real.

---

## Step 5 - Apply readability heuristics

Quick wins for the changed lines:
- **Names**: variable / function name > 5 abbreviations? Rename.
- **Magic numbers / strings**: literal `0.05` or `"urn:ietf:..."` in a conditional? Extract to a named const.
- **Boolean chains**: `if (a && b && !c && (d || e))` — extract to a named predicate function.
- **Nesting depth > 3**: extract to a helper or early-return.
- **Comments explaining WHAT** (vs WHY): the code should explain WHAT itself. Comments should explain WHY (intent, edge case, RFC reference).

---

## Step 6 - Apply test-affinity heuristics

- For every new exported function, is there a corresponding `*.spec.ts` test asserting its contract?
- For every new branch (`if/else/switch`), does the test suite exercise BOTH sides?
- For every new error path (`throw new XException`), is there a negative-path test?

This overlaps with `addMissingTests` but the angle is different: `addMissingTests` checks feature coverage; this checks branch coverage of the NEW code only.

---

## Step 7 - Produce the suggestion report

Format every suggestion as:

```
[FILE] api/src/.../endpoint.service.ts
[METRIC] Lines 1,247 (was 1,180; +67 in this change)
[SMELL] Single-Responsibility growth - emit-side-effects + persistence + cache-update in createEndpoint()
[SUGGESTION] Extract eventEmitter into a dedicated EndpointEventEmitter service (per-event method).
[CONFIDENCE] High - the emit logic is straightforward to move and already has a clear interface (EventEmitter2).
[OWNER ACTION] Author a small refactor commit BEFORE landing this feature commit. Estimated 30 min.
[NOT-A-BLOCKER] Use your judgment; this is a suggestion, not a fail-gate.
```

Confidence levels:
- **High** — same smell pattern that has caused real bugs / friction in the past.
- **Medium** — smell pattern that is generally agreed-upon (SOLID, DRY) but specific impact depends on future evolution.
- **Speculative** — judgment call; reasonable engineers may disagree. Use sparingly.

---

## Step 8 - Cross-link with auditAndUpdateDocs

The doc sweep (Stage 3c) runs AFTER this prompt. If this prompt suggests a refactor that will land in a future commit (deferred), note it in the relevant feature doc so the doc anticipates the upcoming shape change.

---

## Outputs

When this prompt completes, produce:
1. Shape-metrics table for every changed file.
2. Categorized suggestion list (SOLID / DRY / Readability / Test-affinity).
3. Per-suggestion: confidence + owner action + estimated effort.
4. Explicit "no suggestions" output when the changed code is clean (positive signal matters).

---

## Anti-patterns to avoid in this prompt's output

- **DO NOT** suggest renames that are stylistic preference ("camelCase vs snake_case is a holy war, not a smell").
- **DO NOT** suggest premature abstractions (the Rule of Three: extract on the 3rd occurrence, not the 2nd).
- **DO NOT** propose major refactors as part of the current commit. Defer to a separate commit.
- **DO NOT** generate suggestions that would conflict with `auditAndUpdateDocs` recommendations (e.g. don't rename a function that the docs heavily reference without a docs-sweep follow-up).
- **DO NOT** apply this prompt to test files. Tests have different shape rules (long, declarative, repetitive-on-purpose).

---

## When to run this prompt

- **EVERY** commit that touches `api/src/**/*.ts` or `web/src/**/*.{ts,tsx}` (excluding test files).
- After a refactor, to confirm the refactor moved metrics in the right direction.
- After absorbing an external code review, to systematize the reviewer's instincts.
