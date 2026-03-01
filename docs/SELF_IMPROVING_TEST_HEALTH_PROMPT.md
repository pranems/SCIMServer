# Self-Improving Test Health Prompt

> **Purpose:** A reusable, self-improving prompt for diagnosing and resolving test failures in any codebase.
> Copy-paste the prompt below into any AI coding assistant session to systematically identify, root-cause, and fix test failures.

---

## The Prompt

```
What are the known test failures and what are their root causes and what do you think should be done?

Follow this systematic methodology:

### Phase 1: Discovery
1. Locate test result files (JSON, XML, logs) — search for patterns like *-results.json, *-output.txt, test-results/
2. Parse results to extract: total tests, passed, failed, skipped, suite counts
3. List every failing test by: suite name, test name, file path, line number, error message

### Phase 2: Root Cause Analysis
4. Group failures by shared error signatures (same error message, same stack trace origin, same assertion pattern)
5. For each group, trace to the SINGLE root cause — read the source code at the failure point
6. Classify root causes:
   - **Code bug** (production code defect causing legitimate test failures)
   - **Test bug** (mock drift, missing setup, stale assertions, false positives)
   - **Environment** (missing deps, config, database state)
   - **Cascade** (earlier failure leaves state that causes downstream failures)
7. Estimate blast radius: how many failures does each root cause explain?
8. Verify by running isolated subsets (e.g., `jest -t "pattern"`) to confirm cascade vs. inherent failures

### Phase 3: Fix
9. Prioritize: fix the root cause with the LARGEST blast radius first
10. Apply the minimal, targeted fix — do NOT refactor unrelated code
11. For code bugs: cite the RFC/spec/contract that justifies the fix
12. For test bugs: explain why the mock/setup was wrong and what the correct behavior is
13. Run the FULL test suite after each fix to measure improvement
14. Continue until all failures are resolved

### Phase 4: Verification & Documentation
15. Confirm 0 failures across all test levels (unit, E2E, integration)
16. Update test count references in documentation (README, CHANGELOG, session files)
17. Document what was fixed, why, and the before/after test counts

### Phase 5: Self-Improvement
18. After resolution, update THIS PROMPT with any new patterns discovered:
    - New root cause categories encountered
    - New diagnostic techniques that proved effective
    - Anti-patterns that caused the failures (to prevent recurrence)
    - Better grouping heuristics for error signatures

Output format for each root cause:
| Field | Value |
|-------|-------|
| Root Cause ID | A, B, C... |
| Category | code-bug / test-bug / environment / cascade |
| Blast Radius | N of M total failures |
| Files Affected | file:line references |
| Error Signature | Common error pattern |
| Fix | Exact change description |
| Justification | RFC/spec/contract reference |
```

---

## Pattern Library (Self-Improving Section)

> Update this section each time the prompt is used. Add new root cause patterns discovered during diagnosis.

### Known Root Cause Patterns

| Pattern | Category | Signature | Fix Template | First Seen |
|---------|----------|-----------|-------------|------------|
| **Required + ReadOnly catch-22** | code-bug | Attribute is `required: true` + `mutability: 'readOnly'` — omitting fails required check, including fails readOnly check | Skip readOnly attributes in required-attribute validation; server-assigned attributes must not be required from client payloads | 2026-02-27, SchemaValidator `id` attribute |
| **Mock consumed by prior call** | test-bug | Test calls function N times but `mockResolvedValueOnce` set only once — subsequent calls return `undefined` | Re-mock before each call, or use `mockResolvedValue` (persistent) when all calls should return the same value | 2026-02-27, G8f PUT uniqueness double-call |
| **Cascade from unconsumed mocks** | cascade | `jest.clearAllMocks()` does NOT clear `mockResolvedValueOnce` queue — earlier failing tests leave unconsumed Once items that leak into later tests | Fix the upstream failure; cascade resolves automatically | 2026-02-27, G8f tests receiving leaked mocks |
| **Strict mode + coercion interaction** | code-bug | Feature A (boolean coercion) enables feature B (strict schema validation) as a side effect — tests written for A trigger failures in B | Ensure feature flags are orthogonal; fix the underlying validation bug | 2026-02-27, AllowAndCoerceBooleanStrings + StrictSchemaValidation |

### Diagnostic Techniques

| Technique | When to Use | Command Example |
|-----------|-------------|-----------------|
| **Isolated subset run** | Verify if failures are inherent vs. cascade from test ordering | `jest -t "G8f" --no-coverage --verbose` |
| **Error signature grouping** | When >5 failures share similar error text | Group by `message` field in JSON results |
| **Mock queue inspection** | When `undefined` appears where a value is expected | Check `mockResolvedValueOnce` vs `mockResolvedValue` usage; count calls vs. mock setups |
| **Config flag cross-check** | When tests pass individually but fail in suite | Check if test setup enables config flags that trigger unrelated validation |

### Anti-Patterns to Prevent

| Anti-Pattern | Prevention |
|-------------|------------|
| `required: true` + `mutability: 'readOnly'` on same attribute | Server-assigned attributes should never be required from client input |
| Calling function N times in test with only 1 `mockResolvedValueOnce` | Always set mocks for EACH expected call, or use persistent `mockResolvedValue` |
| `jest.clearAllMocks()` assumed to clear `Once` queue | Use `jest.resetAllMocks()` if you need full queue reset, or ensure all mocks are consumed |
| Test enabling multiple feature flags without understanding interactions | Test each flag in isolation first; document flag dependencies |

---

## Usage Notes

- **First run**: Copy the prompt section into your AI assistant. It will systematically diagnose all failures.
- **After each use**: Update the Pattern Library with new discoveries. The prompt gets smarter over time.
- **Sharing**: Share the updated prompt (with Pattern Library) across team members so everyone benefits from accumulated diagnostic knowledge.
- **Scope**: Works for any test framework (Jest, pytest, JUnit, etc.) — adjust command examples as needed.
