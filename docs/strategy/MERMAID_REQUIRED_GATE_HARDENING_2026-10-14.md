# Required Mermaid render gate hardening

**Last verified:** 2026-10-14

## Executive summary

Missing render tooling previously returned exit zero and appeared as a passed
pre-push gate without rendering anything. The required render command now
fails closed when Playwright or the Mermaid bundle is absent. Pre-push delegates
to that command without a success-shaped skip and runs behavioral negative
controls before the full render.

Renderer discovery previously selected an arbitrary bundled `version` literal.
It now reads Mermaid's identified info-diagram database and treats placeholders
or unattributed versions as unknown. No package or lockfile changes are part
of this work. The current editor bundle reports **11.17.0**, while the gate
remains pinned to **11.15.0**. Editor equivalence is **not verified**.

## Required versus diagnostic behavior

| Surface | Required behavior |
|---|---|
| `scripts/render-mermaid.mjs` | Exit 1 for missing Playwright or Mermaid; browser launch and render failures remain nonzero. |
| `scripts/pre-push-checks.ps1` | Always invoke the render command; propagate failure into a FAIL summary and blocked push. |
| `scripts/doctor-mermaid.mjs` | Missing gate Mermaid is a blocker. Unknown editor version is an explicit warning, not a suggested npm pin. Identified drift remains a blocker. |
| `scripts/mermaid-renderers.mjs` | Use the identified Mermaid info-diagram version; return null for a placeholder or an unattributed library version. |

```mermaid
flowchart LR
    PUSH["Normal push"] --> CONTROLS["Behavioral negative controls"]
    CONTROLS --> RENDER["Required render command"]
    RENDER --> TOOLS{"Tooling available?"}
    TOOLS -->|"no"| FAIL["Exit nonzero, FAIL, push blocked"]
    TOOLS -->|"yes"| BROWSER["Chromium, strict, light and dark"]
    BROWSER --> RESULT{"Every diagram renders?"}
    RESULT -->|"no"| FAIL
    RESULT -->|"yes"| PASS["Render gate PASS"]
```

This diagram shows the required gate's failure boundary. Diagnostic renderer
discovery does not certify the active editor session or silently change pins.

## Behavioral contract evidence

Run the focused checks without adding a test framework:

```powershell
node scripts/test-mermaid-gates.mjs
pwsh -NoProfile -File scripts/test/mermaid-pre-push.contract.ps1
```

| Control | Observed RED before fix | GREEN acceptance |
|---|---|---|
| Missing Playwright | Required command exited 0 | Exits 1 and identifies missing Playwright. |
| Missing Mermaid with a resolvable Playwright stub | Required command exited 0 | Exits 1 and identifies missing Mermaid. |
| Missing root tooling in registered pre-push action | PASS and "All gates GREEN" | Renderer invoked, exit 1, FAIL summary, no green push permission. |
| Renderer exits 23 | Already failed correctly | Exit 1 and FAIL summary preserved. |
| Renderer exits 0 | Already passed correctly | Renderer invoked and PASS summary preserved. |
| Profiling placeholder before Mermaid info database | Discovery selected 0.0.0 | Selects identified 11.17.0. |
| Only placeholder or unrelated React version | Selected 0.0.0 or 19.2.3 | Unknown/null, never an actionable pin. |
| Compact info-database literal | Additional format control | Identifies 11.15.0; rejects 0.0.0. |
| Unknown renderer diagnostic | Output contract control | States unverified equivalence without recommending 0.0.0. |
| Identified renderer drift diagnostic | Output contract control | Retains blocker and identifies 11.17.0 as the observed version. |
| Render summary equivalence claim | Claimed matching the VS Code extension even after a drift warning | States actual configuration and requires separate editor verification. |

The PowerShell test executes the actual gate action and runner extracted from
the script's syntax tree. It stubs only the external renderer command; it does
not infer behavior from substring presence in source. Node controls execute the
real render CLI in owned temporary fixtures and clean them in `finally`.
The focused result is ten Node controls and three PowerShell controls passing.
The positive render remains real Chromium with `securityLevel: strict` in
both light/default and dark themes, including nonempty SVG and nondegenerate-size
checks. Hook-owned full validation is not duplicated manually before pushing.

## Renderer evidence and remaining boundary

Observed installation:
`C:\Program Files\Microsoft VS Code\645f29cc31\resources\app\extensions\mermaid-markdown-features`.
Its extension package version is `10.0.0`, not Mermaid's version. The preview
bundle contains `globalThis.injected` with profiling `version: "0.0.0"`,
Mermaid `DEFAULT_INFO_DB` with `version: "11.17.0"`, and React `19.2.3`.
Only the identified Mermaid database is usable for discovery. A minified or
different future bundle without that source is conservatively unknown.

The existing newest-directory heuristic is unchanged and is not proof of which
editor process or preview script is currently loaded. Neither matching a parsed
version nor a successful pinned-gate render proves editor equivalence. Resolve
the identified 11.15.0 versus 11.17.0 drift in a separately approved dependency
change, respecting the corporate proxy/quarantine and CI lockfile policy.
Do not install or downgrade to `0.0.0`.

## Execution issues and root-cause analysis

| ID | Type / severity | Symptom and root cause | Fix and why it works | Detection / earliest possible | Prevention |
|---|---|---|---|---|---|
| MG-I1 | Gate correctness / High | Missing dependencies became PASS: pre-push set exit 0, and render CLI independently exited 0. | Remove wrapper skip and return 1 from CLI; both boundaries now propagate failure. | Parent's fresh-worktree push / missing-tool negative control | Always execute behavioral negative controls in normal pre-push. |
| MG-I2 | Tooling inference / High | Discovery recommended `mermaid@0.0.0`: first generic version belonged to profiling injection, not Mermaid. | Read the identified info database; null for placeholder/unattributed versions; unknown diagnostics explicitly disclaim equivalence. | Bundle inspection / fixture with multiple version identities | Test placeholder, real Mermaid, and unrelated library together and independently. |
| MG-I3 | Environment / Low | Fresh-worktree API/web builds lacked tsc/vite; render lacked Playwright. | After measured failures, restore existing installed dependencies with identical dependency entries. Root uses a junction; API/web use private copies so generation cannot mutate owned worktrees. | Focused prerequisite checks / same | Compare dependency entries before reuse; no registry fetch, package or lockfile edits. |
| MG-I4 | Test isolation / Low | Child doctor rediscovered the host instead of the scratch renderer; Windows restored ProgramFiles despite an explicit child environment override. | Feed the real scratch discovery result into the doctor's imported discovery seam in the scratch fixture; production discovery is unchanged. | Focused diagnostic control / same | Test output against identified fixture data; do not assume child environment overrides isolate system-known paths. |
| MG-I5 | Evidence wording / Medium | Successful focused render ended with "matches the VS Code extension" despite identified version drift. | Report strict/two-theme configuration separately from unverified editor equivalence. | Positive browser receipt / summary output contract | A behavioral negative control rejects the equivalence claim in the render summary. |
| MG-I6 | Fresh-worktree prerequisite / Low | First normal Validate push stopped at API build because the generated Prisma client was absent. Standalone generation then required DATABASE_URL while loading config. | Generate only the private worktree client with an unused loopback URL; generation succeeded without a database connection or shared mutation. | Normal hook build / prerequisite setup | Restore generated artifacts as well as dependencies before a fresh-worktree push. Gate-order redesign is outside this bounded change. |
| MG-I7 | Test worker startup / Medium | Second normal Validate push passed every preceding gate, but five Vitest forks timed out waiting for worker startup. | Existing VITEST_MAX_WORKERS=2 setting made the five failed files pass all 39 tests; no tests were excluded and no assertion timeout was raised. The complete hook retry uses the same limit. Shared-machine contention is a plausible contributor, not a proven OS-level cause. | Normal hook web suite / same | Use the native worker bound on this shared host, keep startup errors blocking, and distinguish passed files from complete suite evidence. |

The second normal hook rendered **754 diagrams in both themes** and passed
API unit **210 suites / 6,035 tests**, API E2E **116 suites / 2,432 tests**
(four pre-existing skips), and all static gates. Web Vitest passed 114 files /
1,552 tests but had five worker-start errors, so that push correctly remained
blocked. These partial results are not a complete Validate pass.

The retry preserves the normal hook and its full test selection:

```powershell
$env:PREPUSH_MODE = 'Validate'
$env:VITEST_MAX_WORKERS = '2'
git push -u origin fix/mermaid-required-gate-20261014
```

Dependency manifests matched the consolidation worktree. API/web lockfile
dependency entries matched exactly; only release-level lock metadata differed.
The npm registry remained the corporate proxy. No configuration or quarantine
settings were changed. No Azure, Entra, deployment, runtime, or UI changes are
included.

### Provenance and completeness

RED/GREEN receipts are actual subprocess outputs from this bounded session.
The available full `events.jsonl` session log was scanned at consolidation
using failure-signal and diagnosis-phrase passes, including tool outputs and
narration rather than compacted recollection. Diagnosed issues map to MG-I1
through MG-I7. The missing-tool failures are
intentional RED/prerequisite evidence, not unresolved runtime defects. The
first discovery fixture format control already passed before the fix; it is
not counted as a reproduced defect. Commit identities and final hook evidence
are recorded in the PR and parent handoff.
Source excerpts, patch/search echoes, and dependency-copy "still running"
notifications were dismissed as non-issues, not counted as execution failures.

## Self-improvement and design disposition

**Test/gate disposition: applied.** Negative controls now run in the normal
hook, proving exit status, actual invocation and summary rather than relying
on source text. Generalized lesson: missing required evidence is a failure,
not an optional diagnostic skip.

**Design/architecture disposition: accepted.** Discovery remains in its
existing shared helper; render remains responsible for tooling/render failures,
and pre-push remains a thin orchestrator. No new strategy, framework, or
dependency is justified for these bounded responsibilities.

Remaining release checks: review and exact-tip CI, parent sequencing, and
separate resolution of genuine editor-version drift. No merge or deployment
is authorized by this change.
