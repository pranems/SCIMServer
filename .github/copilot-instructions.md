# 🧠 Advanced GitHub Copilot Instructions for Maximum Productivity

## 🎯 Core Session Management & Context Awareness

**ALWAYS when starting any session:**
1. 📘 **Context Priority**: Look for `Session_starter.md` first, then `README.md`, then project files for context
2. 🔄 **Live Documentation**: Update `Session_starter.md` with progress, decisions, discoveries, and architectural insights
3. 🎯 **Pattern Recognition**: Follow established patterns, coding standards, and technical decisions from session files
4. 📅 **Progress Tracking**: Add significant changes to update log using format: `| Date | Summary |`
5. ✅ **Task Management**: Mark completed next steps as `[x] ✅ COMPLETED` and add new actionable items
6. 🔍 **Decision Context**: Reference session context when making technical decisions and explain reasoning
7. 🔧 **Tool Utilization**: Check for and utilize available MCP servers, VS Code extensions, and workspace tools
8. 🎨 **Code Quality**: Apply industry best practices, design patterns, and maintain consistent code style

## 📁 Intelligent File & Context Management

**Session File Priority & Discovery:**
- **Primary**: `Session_starter.md` - project memory and context
- **Secondary**: `README.md` - project overview and setup
- **Tertiary**: Scan workspace root, parent directory, `.vscode/`, `docs/`, and common subdirectories
- **Auto-Discovery**: Detect project type (React, Node.js, Python, .NET, etc.) and adjust behavior accordingly
- **Missing Files**: Offer to create session continuity files when missing

**Context Enhancement:**
- **Reference Strategy**: Use `#file:`, `#selection:`, and workspace symbols for precise context
- **Scope Management**: Understand current file, selection, and workspace scope in responses
- **Symbol Recognition**: Leverage IntelliSense and workspace indexing for accurate suggestions

## 🔧 Advanced Tool Integration & Capabilities

**MCP Server Integration:**
- **Check available MCP servers** at session start with a brief mention
- **Use Microsoft documentation MCP** for accurate Azure/Microsoft product information
- **Leverage other available MCP servers** when they provide relevant capabilities
- **Mention MCP server usage** when you use tools from external servers
- **Example**: "Using Microsoft docs MCP to get latest Azure information..."

**VS Code Extension Leverage:**
- **Detect Extensions**: Identify and utilize available VS Code extensions (ESLint, Prettier, GitLens, etc.)
- **Tool Integration**: Suggest extension-specific workflows and configurations
- **Terminal Usage**: Prefer integrated terminal with appropriate shell commands for user's OS
- **Debugging**: Utilize VS Code debugging capabilities and suggest breakpoint strategies

**Workspace Intelligence:**
- **Project Type Detection**: Automatically recognize technology stack and adjust suggestions
- **Dependency Management**: Understand package.json, requirements.txt, .csproj patterns
- **Build Systems**: Recognize and work with npm scripts, Maven, Gradle, Make, etc.
- **Testing Frameworks**: Identify and suggest appropriate testing patterns for the project

## 🎯 Enhanced Communication & Response Patterns

**Granular Response Strategy:**
- **Break Down Complex Tasks**: Split large requests into smaller, manageable steps
- **Step-by-Step Explanations**: Provide clear progression for complex implementations
- **Context Validation**: Confirm understanding before proceeding with major changes
- **Alternative Solutions**: Offer multiple approaches with trade-offs when applicable

**Code Generation Excellence:**
- **Follow Project Conventions**: Match existing code style, naming patterns, and architecture
- **Security First**: Never include secrets, API keys, or sensitive data in code suggestions
- **Error Handling**: Include comprehensive error handling and validation in generated code
- **Documentation**: Add meaningful comments and JSDoc/docstrings for functions and classes
- **Testing Considerations**: Suggest testable code patterns and potential test cases

**Professional Communication:**
- **Clear Explanations**: Use technical accuracy while maintaining accessibility
- **Visual Organization**: Use markdown formatting, lists, and code blocks effectively
- **Reference Documentation**: Link to relevant docs when suggesting libraries or patterns
- **Version Awareness**: Consider compatibility and version requirements for dependencies

## 📊 Session Memory & Learning Discipline

**Update Discipline:**
- Add meaningful progress to the update log section
- Update "Assistant Memory" section with new discoveries and learnings
- Maintain professional, concise update format
- Track technical constraints, architecture decisions, and solved problems
- Note any MCP server tools used during the session

**Productivity Focus:**
- Leverage session memory to avoid re-explaining established context
- Build upon previous session achievements and patterns
- Maintain consistency in coding style and architectural approaches
- Provide seamless continuity across development sessions
- Utilize available MCP servers to enhance capabilities and accuracy

## 🚀 Advanced Prompt Engineering Techniques

**Prompt Optimization:**
- **Be Specific**: Use clear, unambiguous language with concrete examples
- **Set Expectations**: Define desired output format, style, and constraints upfront
- **Add Context**: Include relevant technical background, project constraints, and requirements
- **Break Down Requests**: Split complex tasks into smaller, focused prompts for better results
- **Use Examples**: Provide sample inputs/outputs when requesting specific formats

**Agent Mode Best Practices:**
- **Allow Tool Usage**: Let Copilot use available tools and extensions rather than manual intervention
- **Granular Prompts**: Keep individual requests focused on single responsibilities
- **Express Preferences**: Clearly state preferred approaches, frameworks, or patterns
- **Enable Repetition**: Allow Copilot to repeat tasks for better context understanding
- **Provide Feedback**: Use thumbs up/down and detailed feedback to improve responses

## 🔍 Workspace-Aware Intelligence

**Smart File Discovery:**
- **Auto-detect** configuration files (package.json, tsconfig.json, .eslintrc, etc.)
- **Recognize** project patterns and suggest appropriate tooling
- **Identify** testing frameworks and build systems in use
- **Leverage** existing code patterns and architectural decisions
- **Suggest** improvements based on industry best practices

**Context-Aware Responses:**
- **Reference** specific files, functions, and variables from the current workspace
- **Understand** the current selection, cursor position, and active file
- **Maintain** consistency with existing code style and naming conventions
- **Consider** project dependencies and version constraints
- **Adapt** suggestions to the detected technology stack

## Project Context Awareness

When working on development projects:
- Follow established technology stack patterns from session memory
- Reference previous debugging solutions and architectural decisions
- Maintain consistency with team coding standards documented in session files
- Build incrementally on documented progress and achievements
- Use MCP servers for accurate, up-to-date information when needed

## Character Rules (CRITICAL)
- NEVER use em-dash (`-`, U+2014) anywhere in the codebase - not in code, comments, strings, docs, commit messages, changelogs, or any generated/edited file
- Always use a single hyphen (`-`) where an em-dash would otherwise appear
- This applies to ALL file types: `.ts`, `.js`, `.json`, `.md`, `.ps1`, `.yml`, `.html`, `.css`, `.mjs`, etc.

## Doc Code-Block Formatting Rule (CRITICAL - added 2026-06-23)

Origin: 2026-06-23. The first cut of [docs/PATCH_OPERATIONS_COMPLETE_GUIDE.md](docs/PATCH_OPERATIONS_COMPLETE_GUIDE.md) shipped SCIM payload examples collapsed onto 1-2 lines (`{ "schemas": [...], "Operations": [ { "op": ... } ] }`). That is technically valid JSON but unreadable - a reader cannot scan the envelope, the op, the path, or the value at a glance, and copy-paste into a client produces a wall of text. Standing rules for EVERY fenced code block in ANY `.md` under the repo:

1. **Pretty-print, always.** Any literal JSON (and JSON-like: request/response bodies, config snippets) in a ```json fence MUST be multi-line, 2-space-indented, one structural member per line. Never collapse an object or array onto a shared line to "save space." Each `Operations[]` element sits on its own line(s); a single-key op may stay on one line (`{ "op": "replace", "path": "active", "value": false }`) but the surrounding envelope (`schemas`, `Operations`) is always broken out.
2. **Every ```json block MUST parse.** Before committing a doc, every literal ```json block has to round-trip through a JSON parser (e.g. `ConvertFrom-Json`) with zero errors. A doc commit that adds/edits a ```json block without this check is incomplete.
3. **Schematic templates use ```jsonc, not ```json.** A block that contains placeholders (`<varies>`, `<id>`, `add|replace|remove`) or comments is NOT literal JSON. Fence it as ```jsonc (or ```text) and add a one-line `// Schematic shape ...` note, so the "every ```json parses" gate stays airtight and the reader knows it is a template.
4. **HTTP examples are realistic.** Request/response examples carry the real method + path line, the relevant headers (`Authorization`, `Content-Type: application/scim+json`, `If-Match`, `ETag`), and a pretty-printed body. Prefer values verified against a live run over invented ones.
5. **Applies to all languages.** The same readability bar holds for ```ts / ```powershell / ```bash / ```yaml blocks: no minified one-liners, sensible indentation, and the snippet must reflect what the cited source actually does.

This is now the house norm for all documentation, retroactively and going forward. When editing an existing doc with collapsed code blocks, reformat them as part of the change.

## Git Commit Rules (CRITICAL)
- NEVER use `git commit --amend` unless explicitly specified by the user - always create new commits with `git commit -m "..."`
- NEVER rewrite history on commits that have been pushed
- Always use `git add -A; git commit -m "<descriptive message>"` for saving progress

## Doc Screenshot Hygiene Rule (CRITICAL - added 2026-06-04)

Origin: 2026-06-04 repo-hygiene audit. `docs/screenshots/` had grown to 48 PNGs (3.19 MB) of which 38 were orphaned (referenced by no live doc) and 35 were re-shot in a single commit. PNGs are binary - git stores a full new blob on every re-capture and that blob lives in `.git` forever, so a frequently re-shot screenshot set is a permanent, compounding history-bloat source. Standing rules:

1. **Curated narrative set only.** `docs/screenshots/` holds a small, stable set of images a human reader needs to understand a doc. Today that is the `prod-*.png` set referenced by [docs/UI_GUIDE.md](docs/UI_GUIDE.md). Do NOT commit a per-release full re-shoot.
2. **No orphans.** Before committing screenshots, every PNG on disk MUST be referenced by a live `.md`. Delete any image referenced only by a retired/handoff doc (or accept dead links in the retired doc - do not keep the binary alive for it).
3. **Visual-regression baselines are NOT doc screenshots.** Playwright baselines live under `web/e2e/**/*-snapshots/` and are owned by the Stage 5 visual-regression gate. NEVER place them under `docs/`, and NEVER conflate the two retention rationales.
4. **Scratch captures are git-ignored.** Ad-hoc / Playwright scratch shots go to `docs/screenshots/scratch/` or `tmp-*.png` (both `.gitignore`d) and must never be added by `git add -A`.
5. **Optimize keepers.** Keeper PNGs should be size-optimized (oxipng/pngquant) when tooling is available before commit.

### Scratch Image Handling (CRITICAL - added 2026-06-12 after a 38-PNG stray-capture recurrence)

Origin: 2026-06-12. A Playwright / ad-hoc capture run dropped 38 numbered PNGs (`01-*.png` ... `35-*.png`, 2.69 MB) straight into `docs/screenshots/`. The pre-existing `.gitignore` only listed `scratch/`, `tmp-*.png`, and `*.tmp.png`, so the stray files were NOT ignored and `git add -A` would have committed all 38 as orphans - the exact bug class Rule 4 above is meant to prevent. The fix makes the wrong outcome structurally impossible:

1. **Deny-by-default allowlist in `.gitignore`.** `docs/screenshots/` is now `docs/screenshots/*` ignored with a single re-include `!docs/screenshots/prod-*.png`. Any capture dropped into that folder is ignored automatically; only a deliberately-named `prod-*` keeper can ever be staged. Do NOT weaken this back to a per-pattern denylist.
2. **One canonical capture destination.** All ad-hoc / Playwright captures MUST land in `test-results/ui-screenshots/` (the `saveScreenshot()` helper in [web/e2e/fixtures.ts](web/e2e/fixtures.ts) already writes there) or `docs/screenshots/scratch/`. NEVER point a capture run directly at `docs/screenshots/`.
3. **Promotion is explicit.** To turn a scratch capture into a committed keeper: copy it to `docs/screenshots/prod-<NN>-<surface>.png`, optimize it (Rule 5), AND add a reference from a live `.md` in the SAME commit. A `prod-*` file with no live `.md` reference is still an orphan and is forbidden.
4. **Audit gate.** [scripts/audit-screenshots.ps1](scripts/audit-screenshots.ps1) fails if any tracked PNG under `docs/screenshots/` is not `prod-*` OR is not referenced by a live `.md`. Run it in Stage 1 (static gates) whenever `docs/screenshots/` or a doc that embeds an image changes.

### UI Guide Refresh Process (CRITICAL - added 2026-06-12)

[docs/UI_GUIDE.md](docs/UI_GUIDE.md) is the human-facing tour of the running app and goes stale when surfaces change or new routes ship without a screenshot. To keep it current without bloating git history:

1. **Reproducible re-shoot.** Use [scripts/capture-ui-guide.ps1](scripts/capture-ui-guide.ps1) to re-capture ONLY the curated `prod-*` surfaces against a live URL at a pinned viewport, optimize them, and overlay the existing keepers. NEVER do an uncurated full re-shoot (Rule 1 of the hygiene rule).
2. **Provenance.** The capture command + date + target URL are recorded at the top of UI_GUIDE.md so reviewers can tell how stale a shot is and reproduce it.
3. **Coverage check.** The audit gate (`audit-screenshots.ps1 -CheckRouteCoverage`) flags any top-level route under `web/src/routes/` that UI_GUIDE.md neither screenshots nor explicitly lists as intentionally undocumented - mirroring the existing "every new lazy route needs a size-limit entry" discipline.
4. **Re-shoot is intentional, never blind.** A re-shoot commit MUST state in its message which surfaces changed and why, and the binary diff MUST be reviewed (per the visual-regression discipline) before the new keepers are committed.

## Schema-Characteristic Test Rule (CRITICAL - RFC 7643 §2.2 + §7)

When writing tests against `/Schemas` attribute definitions (unit, E2E, or live), the test MUST:

1. **Check for the presence** of the attribute characteristic in the published schema.
2. **If present:** enforce the published value as authoritative (validate it is a valid SCIM keyword, or use it as the expected value).
3. **If absent:** substitute the RFC 7643 §2.2 default for that characteristic before asserting.

NEVER hardcode an expected characteristic value (e.g. `expect(attr.uniqueness).toBe('none')`) without going through the present/default branch. Doing so creates churn every time a preset legitimately tightens or relaxes a characteristic and produces silent regressions like the May 2026 Group.displayName uniqueness flip.

**RFC 7643 §2.2 defaults when a characteristic is omitted:**

| Characteristic | Default |
|---|---|
| `required` | `false` |
| `caseExact` | `false` |
| `mutability` | `readWrite` |
| `returned` | `default` |
| `uniqueness` | `none` |
| `multiValued` | `false` |
| `type` | `"string"` |

**TypeScript helper:** `api/test/e2e/helpers/schema-characteristics.helper.ts` exports `effectiveCharacteristic()`, `expectEffectiveCharacteristic()`, and `expectCharacteristicIn()`. Always use these in `*.e2e-spec.ts` instead of raw `attr.<key>` access.

**PowerShell helper (live-test.ps1):** Use `Get-EffectiveUniqueness` (and add a similar function for any other characteristic before asserting it). Never write `Test-Result -Success ($attr.<characteristic> -eq "<value>")` without going through the effective-value computation.

**Tightening allowance:** Per RFC 7643 §7 a server MAY enforce uniqueness/mutability stricter than what it advertises (e.g. advertise `uniqueness:none` while enforcing `server`). Tests that verify "the server publishes a valid keyword and the runtime enforcement is consistent" must use `expectCharacteristicIn(attr, key, VALID_<KEYWORD>)`, not a single-value `toBe()`.

## Always Add Playwright Coverage Rule (CRITICAL)

Whenever the agent observes a UI behavior - including a bug, a new feature, a fix, a regression, a workaround, a flow change, or any user-visible delta - it MUST add or update a Playwright spec under `web/e2e/` that exercises that behavior end-to-end through the browser **before** the work is considered complete. This rule applies to:

- New routes, pages, tabs, drawers, modals, dialogs
- New buttons, links, form fields, validation messages
- New error states, empty states, loading states, retry behaviors
- New keyboard shortcuts, command palette commands, accessibility flows
- Fixed bugs (spec MUST reproduce the bug as a regression test)
- Behavioral changes to existing flows (update the existing spec)
- Combination flows (multi-step user journeys spanning >= 2 pages)

The spec MUST be runnable via `npx playwright test --reporter=line` against all three deployment form factors: local dev server (`http://localhost:4000`), local Docker compose (`http://localhost:8080`), and Azure dev (`E2E_BASE_URL=https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io`, `E2E_TOKEN=changeme-scim`). A change that ships without its Playwright spec is incomplete. The Stage 5.3 + 5.4 gates fail when any new web/ behavior in the diff lacks Playwright coverage.

## Visual Layout + Self-Improvement Discipline (CRITICAL - added 2026-05-29 after Finding-D)

Origin: 2026-05-29 P1 follow-up deploy. The `<span>`-based `TruncatedText` primitive applied `text-overflow:ellipsis + overflow:hidden + white-space:nowrap` but never set `display:inline-block`, so the CSS was inert and userNames rendered at full width on dev. Four separate gates (vitest layout assertions, Playwright `getComputedStyle` check, visual-regression PNG diff, operator's first manual look) all failed to flag it. The operator caught it after dev deploy by eye. The following rules are the standing fix for this whole class of "CSS applied but layout not achieved" failure.

### R1. Visual-layout assertions MUST measure bounds, not CSS properties

Any Playwright spec exercising truncation / overflow / ellipsis / masking / sticky positioning / responsive width / clipping MUST assert at least one of:

- `el.scrollWidth > el.clientWidth` (content overflowed → ellipsis/clip actually fired). **This is the most reliable signal across browsers.** Measure the inner truncation primitive (the `<span>` with `text-overflow:ellipsis`), NOT the outer `<td>`/`<div>` wrapper (which usually has `overflow:hidden` and would never report overflow).
- `el.clientWidth <= <expected-max-width-px>` (element is actually bounded)
- `el.getBoundingClientRect().width <= <expected>` (rendered width is bounded)

Asserting only `getComputedStyle(el).textOverflow === 'ellipsis'` or `whiteSpace === 'nowrap'` is FORBIDDEN as the sole assertion. Those checks verify CSS was applied, not that layout happened. They will green-light a bug where the property is set but the element's `display` value prevents it from taking effect.

**`locator.innerText()` and `node.textContent` are NOT valid signals for ellipsis activation.** They return the full underlying DOM text regardless of CSS clipping. The 2026-05-29 Finding-D follow-up spec hit this exact trap: even after the fix was live and ellipsis was rendering visibly, `innerText().length === fullValue.length` because innerText serialises the un-clipped source string. Use `scrollWidth > clientWidth` instead.

### R2. Vitest tests MUST NOT assert visual-layout outcomes

JSDOM (vitest's DOM) does not compute layout. `getBoundingClientRect()` returns `{0,0,0,0}`, `scrollWidth === clientWidth` always, `offsetWidth === 0`. Any vitest assertion about truncation, overflow, viewport fit, scrollbar presence, sticky behavior, or column width is a false-positive farm. Move those assertions to Playwright. Vitest assertions are reserved for: rendered DOM structure (`getByTestId`), text content, props/events/callbacks, and ARIA semantics. Layout is Playwright-only.

### R3. A visual-regression FAIL is a BLOCKER until the diff PNG is inspected

When Stage 5.3 reports a visual-regression diff, the agent MUST:

1. Open the `*-diff.png` (or describe inability to open it) for every failing test.
2. State explicitly in chat AND in the commit message: "intended visual change because <X>" or "unintended regression - investigating."
3. Only AFTER a written "intended" classification may the agent regenerate baselines.
4. Regenerating baselines without inspecting the diff is FORBIDDEN.

Default response to a visual-regression FAIL is "investigate," NOT "regenerate." The 4-fail / 113-pass result on the 2026-05-29 dev run was dismissed as "expected P1 drift"; one of those 4 was the actual bug the gate was trying to flag. This rule prevents the recurrence.

### R4. Truncation primitives MUST self-contain their display context

A primitive that depends on a specific parent layout context to function (e.g., `display:flex` parent + `min-width:0` + sized column) is fragile and will silently fail in raw `<td>`, `<span>`, or `<div>` contexts. Truncation primitives MUST set their own `display:inline-block` (or `block` for full-width variants) so the CSS contract holds regardless of parent. The same applies to: focus rings (own `position:relative`), sticky elements (own `position:sticky` + `top`), z-index layers (own stacking context), and transforms (own `will-change` hints).

### R5. Tables with truncating cells MUST use `table-layout: fixed` + explicit column widths

`table-layout: auto` (the browser default) sizes columns to the natural width of their content. This defeats any `max-width` on inner cell content - the column itself expands. Any `<table>` containing a `<CopyableField truncate>` or `<TruncatedText>` MUST either:

- Set `table-layout: fixed` on the `<table>` AND give each `<th>` an explicit width, OR
- Set `max-width` directly on each affected `<td>` (less robust; only works if the column is narrow enough that contents would overflow anyway).

### R6. UI commits MUST receive explicit operator visual verification before "ready for prod"

The agent may not declare a UI commit "validated on dev" or "ready for prod" based on automated gates alone. The agent MUST request and receive an explicit operator statement of the form "I have visually verified <surface> on dev URL <X>; the change looks correct." Until that operator statement arrives, the agent's status is "awaiting visual verification," not "validated." This is the only gate that catches the "CSS applied but layout not achieved" class of bug, because every synthetic gate can be defeated by writing the wrong assertion (R1) or by trusting a misleading green (R3).

### R7. Self-improvement step in every activity (commit / prompt / gate / pipeline run)

Origin: 2026-05-29 operator request "be self-improving and not digressing/regressing." The agent MUST end every completed activity with one of:

- **(a) Improvement identified + applied in-place**: add the rule/test/check that would have caught the issue. Land it in the SAME commit chain.
- **(b) Improvement identified + scheduled**: open a follow-up in `docs/strategy/SELF_AUDIT_<date>.md` with the gap + owner + target date.
- **(c) No improvement identified**: state this explicitly with one-line justification ("ran a green test; rule already exists").

Every audit prompt (Stage 3a-c) MUST end with: "What did this run reveal that the rule set / test set / pipeline does not currently cover? Was the gap closed in-place, scheduled, or accepted?" Every gate failure analysis MUST update the gate definition with the lesson learned. Every operator-surfaced bug MUST trigger a "why didn't a gate catch this?" walk and produce at least one new rule, test, or audit step in the same commit chain that fixes the bug.

This is the discipline that prevents the agent from repeating the same class of mistake. Without it, every fix is local; with it, the rule set self-densifies over time. **Refusing to add a self-improvement step because "the fix is small" or "we already have a rule that covers this loosely" is FORBIDDEN** - the loose rule did not prevent the bug, so the rule needs to be tightened or operationalized.

### R8. Standing audit prompt: `visualRegressionDiagnosis` (Stage 5.3a)

When Stage 5.3 produces ANY Playwright FAIL, a `visualRegressionDiagnosis` prompt MUST run before any deploy proceeds. The prompt walks: (a) list every failed test, (b) for each, open and describe the diff PNG, (c) classify intended vs unintended, (d) if intended, generate the CHANGELOG entry + regenerate baselines + commit; if unintended, fail the deploy and route to bug-fix flow. This is the structural fix for R3 - without an audit prompt forcing the discipline, the agent can still dismiss a real bug as "expected drift" (which is exactly what happened on 2026-05-29).

### R9. Copy-everywhere primitive discipline (Phase Q, added 2026-05-29)

Origin: 2026-05-29 operator request "make sure in all sections subsections screens tabs subtabs that the copy button is present for all the test display fields and boxes for display and output and input, for input also have undo redo and other useful buttons also have copy as json buttons at all possible places." The complete UI was inconsistent: some surfaces had hand-rolled copy buttons (each with their own state machine), some had raw `<pre>{JSON.stringify(...)}</pre>` blocks with NO copy affordance, some had bare `<Input>`s with no undo/copy/reset. The fix is the primitive trio + standing rule below.

**R9.1. Three primitives, one source of truth.** Every "make this thing copyable" pattern in the app MUST go through one of:

- **`CopyableField`** ([web/src/components/primitives/CopyableField.tsx](web/src/components/primitives/CopyableField.tsx)) - inline display of a single string value paired with a copy button. Use for IDs, URNs, paths, timestamps, scalar attribute values, any monospace single-line text the operator might paste elsewhere.
- **`CopyableJsonBlock`** ([web/src/components/primitives/CopyableJsonBlock.tsx](web/src/components/primitives/CopyableJsonBlock.tsx)) - read-only pretty-printed JSON viewer with built-in header copy button. Use INSTEAD OF hand-rolled `<pre>{JSON.stringify(x, null, 2)}</pre>` patterns. Enforces R5 overflow safety so long unbreakable tokens cannot push the pre past its container. Drawer / detail / response / preview / result blocks all use this.
- **`CopyJsonButton`** ([web/src/components/primitives/CopyJsonButton.tsx](web/src/components/primitives/CopyJsonButton.tsx)) - section-level "copy this whole thing as JSON" button. Use in section headers (drawer "Copy full resource", schema row "Copy schema as JSON", bulk envelope "Copy full envelope", workbench response "Copy as JSON") and for any structured payload the operator wants to grab without the JSON block being visible.

**R9.2. Every editable input MUST use `EditableField`.** [web/src/components/primitives/EditableField.tsx](web/src/components/primitives/EditableField.tsx) wraps Fluent `<Input>` / `<Textarea>` with 4 first-class affordances every editable field should carry: copy, undo, redo, reset-to-original. Native browser Ctrl+Z only covers one keystroke session and silently fails on paste / programmatic reset / focus-loss-and-return. EditableField makes all 4 discoverable + keyboard-reachable + clipboard-friendly.

**R9.3. Forbidden patterns.** New code MUST NOT:
- Render `<pre>{JSON.stringify(x, null, 2)}</pre>` directly. Use `CopyableJsonBlock` so the copy button + R5 overflow safety come for free.
- Hand-roll a local `useState<'idle' | 'copied' | 'error'>('idle')` + `navigator.clipboard.writeText(...)` + `setTimeout` cycle. All copy state goes through `useCopyToClipboard` (via the 4 primitives). This guarantees uniform UX and prevents stale-state bugs.
- Render a bare `<Input value={x} onChange={...} />` for a SCIM scalar that the operator might want to copy / undo / reset. Use `EditableField`.

**R9.4. Test ID pattern.** All 4 primitives accept `data-testid`; their buttons derive predictably:
- `CopyableField`: `<id>` (root) + `<id>-copy-button`
- `CopyJsonButton`: `<id>` (the button itself)
- `CopyableJsonBlock`: `<id>` (root) + `<id>-copy-button` + `<id>-pre`
- `EditableField`: `<id>` (root) + `<id>-input` + `<id>-copy-button` + `<id>-undo-button` + `<id>-redo-button` + `<id>-reset-button`

Specs assert presence by testid, never by text label, so future label tweaks do not break specs.

**R9.5. New-surface checklist.** When authoring a new page / tab / drawer / dialog / popup / detail panel, the PR MUST surface every display value, every editable input, every JSON payload through one of the 4 primitives. The `addMissingTests` prompt + `codeReviewSelfAudit` prompt both check for raw `<pre>` blocks + bare `<Input>` usages and flag them as R9 violations.

## Dev Deployment Pipeline Rule (CRITICAL)

Whenever the operator asks to "deploy to dev", "prepare for prod", "run full validation", "test on the latest deployment", "do the full pipeline", or any equivalent phrase, the agent MUST:

1. Run `pwsh -NoProfile -File scripts/dev-deployment-pipeline.ps1` (full mode, no `-Skip*` flags), OR walk every numbered stage in [.github/prompts/devDeploymentPipeline.prompt.md](.github/prompts/devDeploymentPipeline.prompt.md) manually with a per-stage PASS / FAIL / SKIPPED-with-reason row in a report file under `test-results/dev-deploy-<timestamp>.md`.
2. NEVER claim "validation complete" or "dev is green" without an explicit per-gate result. Aggregated phrases ("all tests passed") are insufficient.
3. NEVER skip Stage 5.3 (Playwright vs dev) because "Playwright is slow". The earliest such miss (v0.52.3 dev-deploy run, 2026-05-29) is exactly why this rule exists.
4. NEVER defer Stage 1.6 (size-limit) failures as "pre-existing baseline". Either fix the config or fix the bundle. The v0.52.3 run treated a real failure as deferrable, then the operator surfaced it.
5. NEVER promote to prod without an explicit `promote to prod` confirmation message from the operator.

References: [scripts/dev-deployment-pipeline.ps1](scripts/dev-deployment-pipeline.ps1) - orchestrator. [.github/prompts/devDeploymentPipeline.prompt.md](.github/prompts/devDeploymentPipeline.prompt.md) - authoritative gate walk. Both are kept in lockstep with this section.

## Feature / Bug-Fix Commit Checklist (Standing Rule)

Every feature or significant change commit MUST include ALL of the following before committing. Do NOT skip any item:

1. **Unit Tests** - Service-level (`.service.spec.ts`) and Controller-level (`.controller.spec.ts`) tests covering the new behavior
2. **E2E Tests** - End-to-end spec (`test/e2e/*.e2e-spec.ts`) exercising the feature through HTTP
3. **Live Integration Tests** - New test section in `scripts/live-test.ps1` covering the feature for all deployment scenarios (local server on port 6000, Docker container on port 8080, Azure). Must be runnable with both `.\live-test.ps1` (local) and `.\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"` (Docker)
3a. **Playwright Spec** (when the change touches `web/src/`) - End-to-end browser spec under `web/e2e/*.spec.ts` exercising the new/changed UI surface, runnable against local dev (`http://localhost:4000`), Docker compose (`http://localhost:8080`), AND Azure dev (`https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io`, `E2E_TOKEN=changeme-scim`). For a bug fix, the spec MUST reproduce the bug as a regression test before the fix lands. See "Always Add Playwright Coverage Rule" above.
4. **Feature Documentation** - Dedicated doc in `docs/` (e.g., `docs/G8E_RETURNED_CHARACTERISTIC_FILTERING.md`) with architecture, RFC references, Mermaid diagrams, implementation details, and test coverage tables
5. **INDEX.md Update** - Add the new feature doc reference to `docs/INDEX.md`
6. **CHANGELOG.md Update** - Version bump entry with full test counts and feature summary
7. **Session & Context Updates** - Update `Session_starter.md` and `docs/CONTEXT_INSTRUCTIONS.md` with new test counts, version, and feature status
8. **Version Management** - Bump version in `package.json` and all relevant version references
9. **Response Contract Tests** - Verify API responses contain ONLY documented fields (key allowlist assertion at unit + E2E + live levels). Internal runtime fields (prefixed with `_`) must never appear in responses. Use `expect(ALLOWED_KEYS).toContain(key)` pattern, not just `toHaveProperty`.

## Mandatory Quality Gates (Standing Rule)

After implementation AND before considering work complete, ALL of the following quality gates MUST be executed. Use TDD (Red-Green-Refactor) for ALL implementation - including the smallest spot-fix. The gates are organized into 6 stages (Stage 0 -> Stage 5). NEVER skip a stage. NEVER reorder. Higher-numbered stages depend on lower-numbered stages.

### Stage 0 - TDD Discipline (every commit, every step)
0.1. **RED first** - Write the failing unit/E2E/live test for the new behavior BEFORE touching production code. Confirm RED in the test output (assertion message, not just "Tests Failed: N").
0.2. **GREEN minimal** - Implement the smallest change that makes the failing test pass. Do NOT add extra features.
0.3. **REFACTOR safe** - Clean up only with the GREEN suite still green after every edit.
0.4. **No exceptions** - even for "one-line fixes" or "obvious bugs." The Finding-B inmemory parity gap (May 2026) was a one-line missing guard that escaped review for months because it had no unit-level lock. RED-first prevents the next one.

### Stage 1 - Local Static Gates (fast, before any test run)
1.1. **`lintAndStaticAnalysis` prompt** - Runner for all the gates below; parses output, prioritizes fixes, blocks on regression in baseline counts.
1.2. **API TypeScript build** - `cd api; npm run build` -> exit 0, zero errors.
1.3. **API ESLint** - `cd api; npm run lint` -> 0 errors. Warning count is a ratchet ceiling; the current baseline at v0.52.0-alpha.2 is 0 errors / 465 warnings. New code must not increase that ceiling without a CHANGELOG note.
1.4. **Web TypeScript check** - `cd web; npx tsc --noEmit` -> the prod-file error baseline at the start of work must not increase. Test-file errors are tolerated only when they are pre-existing on HEAD; any new test file you add must compile clean. Today's baseline: 96 errors (87 test / 9 prod). Aspirational target: 0 prod-file errors; ratchet down over time, never up.
1.5. **Web ESLint** - if `web/eslint.config.{mjs,cjs,js}` exists, run `cd web; npx eslint src` -> 0 errors. If no config exists yet, this gate is N/A until Option-4 work adds one.
1.6. **Web production build** - `cd web; npm run build` -> 0 errors. Confirms vite + esbuild can ship the bundle.
1.7. **Web size-limit budgets** - `cd web; npm run size` -> all budgets pass. Reports 24+ per-route + entry + shared-primitives budgets that lock first-paint download.
1.8. **`bundleBudgetAudit` prompt** - Enforces that every NEW lazy route added under `web/src/routes/` has a corresponding entry in `web/package.json` `"size-limit"` array. Catches the "ship a route with no ceiling" bug class.
1.9. **`prismaMigrationAudit` prompt** - Verifies `api/prisma/schema.prisma`, `api/prisma/migrations/*`, and the runtime DB stay in lockstep. Run whenever `api/prisma/` is touched. Catches the "schema edited but migration not generated" CD blocker.

### Stage 2 - Local Test Gates (run after Stage 1 is green)
2.1. **API unit jest** - `cd api; npm test` -> all suites pass. Capture suite + test counts; record in CHANGELOG.
2.2. **API E2E jest** - `cd api; npm run test:e2e` -> all suites pass. Capture counts.
2.3. **Web vitest** - `cd web; npm test` -> all suites pass. Capture counts.
2.4. **Web vitest coverage gate** - `cd web; npm run test:coverage` -> meets Phase H4 ratchet thresholds (lines:78 / branches:70 / functions:65 / statements:75 floor; raise as repo improves, never lower).
2.5. **`crossBackendParityAudit` prompt** - For ANY change that touches a file with an `isInMemoryBackend` branch, walk through the parity matrix (Q1-Q4) and confirm both backends behave identically. This is the Finding-B preventer (May 2026 - InMemory endpoint-create was missing the duplicate-name guard Prisma had).
2.6. **API + Web tests across persistence backends** - `pwsh scripts/test-all-modes.ps1` (Phase H5 orchestrator) covers 6 modes including api-unit-prisma + api-unit-inmemory + api-e2e-prisma + api-e2e-inmemory. Companion runner to 2.5; the prompt does the thinking, the orchestrator does the execution.

### Stage 3 - Self-Improving Audit Prompts (every feature/bug-fix commit)
Stage 3 is split into three sub-stages by the SCOPE of what each prompt audits. Run them in this order; later sub-stages depend on earlier ones being green.

#### Stage 3a - Test-Completeness Audits (gap-fill BEFORE confirming correctness)
3a.1. **`addMissingTests` prompt** - Inventory current test coverage vs the change. Close every gap at the unit + E2E + live layer BEFORE moving on. The May 2026 Group.displayName uniqueness flip would have been caught a release earlier had this gate run.
3a.2. **`apiContractVerification` prompt** - Confirm every response shape matches the documented contract. Use key-allowlist assertions (`expect(ALLOWED_KEYS).toContain(key)`), never `toHaveProperty`. Internal runtime fields prefixed with `_` MUST be invisible at every public response.
3a.3. **`error-handling-verification` prompt** - Audit every error path: HTTP status, SCIM `scimType` keyword (RFC 7644 Table 9), structured diagnostics envelope (`attributePaths[]`, `activeConfig`, `filterExpression`), and the smart-error-explainer client surface.

#### Stage 3b - Cross-Cutting Audits (verify the IMPL against external standards)
3b.1. **`logging-verification` prompt** - Verify the new code path produces correctly-categorized + correctly-leveled log entries, with PII redacted, requestId propagated, and slow-request thresholds honored.
3b.2. **`auditAgainstRFC` prompt** - RFC 7643 (Schema) + RFC 7644 (Protocol) compliance review for any change that touches Schemas/ResourceTypes/ServiceProviderConfig/Users/Groups/Bulk/PatchOp/.search/discovery.
3b.3. **`endpointConfigFlagAudit` prompt** - Verifies the 14-boolean-flag + logLevel system stays architecturally complete (registry + default + validator + enforcement + tests at every layer + doc + UI Switch + UI test = 10 cells per flag). Run when adding/modifying any flag.
3b.4. **`securityAudit` prompt** - Auth, secrets, input validation, output PII, security headers, rate limits, OWASP Top 10 coverage. Re-run after every dependency bump.
3b.5. **`dependencyCveSweep` prompt** - NPM-audit / CVE scan against api/ + web/ with Critical/High severity blocking commits. Companion to `securityAudit` but triggered by `package.json`/`package-lock.json` changes AND on a weekly schedule. Both prompts must be green for Stage 3b to pass.
3b.6. **`performanceBenchmark` prompt** - p50/p95/p99 latency, DB query count per request, memory headroom, no N+1 patterns. Compare against the prior commit's baseline; regression > 10% requires explicit justification in the commit message.

#### Stage 3c - Code Hygiene + Documentation Sweep (after all impl + tests are GREEN)
3c.1. **`codeReviewSelfAudit` prompt** - SOLID / DRY / readability / complexity audit of CHANGED files only. Suggestions, not blocks. Catches god-class growth, helper-bloat, and naming drift that the RFC/security/perf prompts don't see. Reference: the May 2026 Design Deep Analysis found 5 SOLID violations (SchemaValidator god class 1,467 lines, service-helpers 1,230 lines, etc.) - this prompt is the standing engine for catching the next one.
3c.2. **`auditAndUpdateDocs` prompt** - Sweep `docs/INDEX.md`, `Session_starter.md`, `docs/CONTEXT_INSTRUCTIONS.md`, `CHANGELOG.md`, `README.md`, plus every feature doc that references test counts / version / commit SHA / behavior the change touches. Use sub-agent for thoroughness on large changes.

### Stage 4 - Pipeline + Multi-Mode Deployment Validation
4.1. **`fullValidationPipeline` prompt** - End-to-end local build + Docker build + container smoke. Must pass cleanly before any deployment.
4.2. **Docker compose live tests** - `docker compose up -d api`, then `pwsh scripts/live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"` -> all current-baseline tests pass (current: 984+ assertions). Confirms the Prisma backend behaves identically to the inmemory mode AND identical to dev.
4.3. **Local node live tests** - `node api/dist/main.js` (inmemory backend, port 6000), then `pwsh scripts/live-test.ps1` -> all current-baseline tests pass. Confirms inmemory parity. **A live-test failure on local that passes on Docker/dev is a parity bug; fix it at the source (usually `api/src/infrastructure/repositories/inmemory/` or in the service-layer `isInMemoryBackend` branch), don't suppress.**
4.4. **Dev Azure deploy + live tests** - Publish image with current commit SHA tag, deploy to `scimserver-dev` Azure Container App, run `pwsh scripts/live-test.ps1 -BaseUrl https://scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io -ClientSecret "changeme-oauth"` -> all current-baseline tests pass (current: 1,027 assertions). **This is the sub-phase gate the commit message names.**

### Stage 5 - UI-Specific Gates (when the change touches `web/`)
5.1. **`uiTestAndValidation` prompt** - Full React/vitest test suite + a11y + visual regression sanity check.
5.2. **`playwrightSpecHygieneAudit` prompt** - Audit `web/e2e/*.spec.ts` files against the currently-shipped UI surface. Delete stale specs (specs testing components deleted in Phase I v0.48.0: `raw-logs`, `manual-provision`, `database-browser`, `app-shell`, `activity-feed`, `live-data-verification`, `new-ui`). Run this BEFORE 5.3 so the next run produces a trustworthy signal.
5.3. **Playwright E2E vs dev** - `cd web; $env:E2E_BASE_URL='<dev FQDN>'; npx playwright test --reporter=line` -> all currently-live specs pass. Visual-regression baseline drift is acceptable only when accompanied by a CHANGELOG entry justifying the UI evolution AND fresh baselines committed in the same change.
5.4. **Browser binary sync** - If `npx playwright install` is required (binary version drift), run it as a one-shot setup step before 5.3. Not a per-commit gate, but a per-branch / per-clean-clone gate.

### Stage 6 - Commit Hygiene + Release Documentation
6.1. **Version bump** - `api/package.json` + `web/package.json` + lockfiles regenerated **inside node:24-alpine** for cross-platform reproducibility (matches the deployed runtime in [api/Dockerfile](api/Dockerfile)).
6.2. **CHANGELOG.md** - One entry per minor/patch with explicit before/after test counts at every layer (API unit, API E2E, Web vitest, Live SCIM, Playwright, PowerShell contract), version delta, files changed summary, and per-phase quality gate result.
6.3. **Session_starter.md** + **docs/CONTEXT_INSTRUCTIONS.md** updates - Latest test counts, version, recent achievements row.
6.4. **`generateCommitMessage` prompt** - Use it to compose the commit message; ensures the standing rule about per-sub-phase gate naming is honored.
6.5. **No `--amend` on pushed commits, no `--force` push, no `--no-verify`** - All three are disallowed by the standing operational-safety rules.

### Stage X - Meta / Strategy Evolution (not per-commit)
Stage X does NOT gate any single commit. It runs on inflection points to evolve the gate strategy itself. The other 6 stages are the floor; Stage X is what raises the floor over time.

X.1. **`gateStrategySelfAudit` prompt** - Meta-prompt that introspects: (a) **internal drift** - baseline rot, prompt rot, coverage rot, complexity rot, doc rot, escape patterns; (b) **external standards intake** - SCIM RFC errata, framework upgrades, ecosystem changes (with URL citations REQUIRED); (c) **incident learnings** - auto-pull every `fix:` commit since last run; (d) **recommended additions, retirements, ratchets** - actionable findings with confidence + owner assignment.

X.2. **`securityBestPracticesIntake` prompt** - Sibling to X.1, scoped exclusively to security best-practices intake across 10 categories: (1) Standards bodies (OWASP, CWE, NIST, CIS); (2) Protocol-level (OAuth 2.1, OIDC FAPI, DPoP, TLS); (3) Supply chain (SLSA, npm provenance, Sigstore, GHA pinning); (4) Cryptographic deprecations (NIST SP 800-131A); (5) Container/runtime (distroless, rootless, trivy, syft, cosign); (6) CI/CD security (OIDC, branch protection, signed commits, Dependabot); (7) Web/UI security (CSP, HSTS, COOP/COEP, Trusted Types); (8) Privacy/PII (GDPR, CCPA, PIPL); (9) Cloud-specific (Azure Security Baselines, Managed Identity, WAF); (10) AI/LLM-specific (OWASP LLM Top 10, prompt injection, model supply chain). Each finding requires URL citation, confidence level, and concrete owner action. Output: structured Markdown report under `docs/strategy/SECURITY_INTAKE_<YYYY-MM-DD>.md` with proposed deltas to this file.

**X.1 + X.2 trigger conditions (shared, 4 types):**
| Trigger | Cadence | Scope | Why |
|---|---|---|---|
| Release cuts | Every `v0.X.0` stable rollup | last release cycle | Natural reflection point |
| Calendar | Monthly (1st of month) | full sweep | Catches drift in periods without release |
| On-demand | User invokes | operator-specified | Bug-hunt / planning / threat-hunt mode |
| Incident-driven | After ANY bug/security-incident escapes Stages 1-5 to live/dev | focused on the escape path | Auto-captures Finding-B / Finding-C / supply-chain class events |

**Hard constraints (apply to both X.1 and X.2):**
- External claims require URL citations (no URL = "speculative - verify before action").
- Confidence levels required (`Critical` / `High` / `Medium` / `Speculative` for X.2; `High` / `Medium` / `Speculative` for X.1).
- Owner action required on every finding.
- New prompt recommendations require >=2 escape-pattern matches (single-escape patterns go into an EXISTING prompt as a new check).
- Prompt retirement requires 30+ days of no-fire evidence.
- Baseline ratchets require a measured snapshot supporting the new value.
- Tool-dependent recommendations flagged DEFERRED if the tool isn't installed; do not recommend a gate the runner can't execute today.

**X.1 + X.2 output convention:** structured Markdown reports under `docs/strategy/`:
- `docs/strategy/SELF_AUDIT_<YYYY-MM-DD>.md` from X.1
- `docs/strategy/SECURITY_INTAKE_<YYYY-MM-DD>.md` from X.2
- Both end with "Proposed deltas to copilot-instructions.md" for operator review.

### Cross-Cutting Security Gate Map
Security checks are intentionally threaded through every stage. This map makes the threading visible so the next reviewer knows where each security concern is enforced.

| Concern | Stage(s) where checked | Prompt / gate |
|---|---|---|
| Hardcoded secrets in staged diff | 1.1 | `lintAndStaticAnalysis` Step 3.2 |
| em-dash (style proxy for un-reviewed bot output) | 1.1 | `lintAndStaticAnalysis` Step 3.1 |
| `console.log` leakage to prod | 1.1 | `lintAndStaticAnalysis` Step 3.3 |
| Dependency CVE (Critical/High blocks; Moderate tracked) | 3b.5 | `dependencyCveSweep` |
| Auth / authz / input validation / output PII / OWASP Top 10 (per-commit) | 3b.4 | `securityAudit` |
| Schema characteristics that imply security (uniqueness/mutability tightening) | 3b.2 | `auditAgainstRFC` + Schema-Characteristic Test Rule |
| Response key allowlist (no internal `_` fields leak) | 3a.2 | `apiContractVerification` |
| SCIM error envelope (no PII in error detail) | 3a.3 | `error-handling-verification` |
| PII redaction + structured-log hygiene | 3b.1 | `logging-verification` |
| Live SCIM contract on the wire (auth headers, OAuth flow, ETag flow) | 4.2 / 4.3 / 4.4 | `scripts/live-test.ps1` |
| **External security-landscape changes (proactive)** | **X.2** | **`securityBestPracticesIntake`** |
| Container image CVEs (OS-level base image) | 4 (CI) | **ACTIVE** via [aquasecurity/trivy-action](https://github.com/aquasecurity/trivy) in [.github/workflows/build-and-push.yml](.github/workflows/build-and-push.yml) + [.github/workflows/build-test.yml](.github/workflows/build-test.yml); HIGH+CRITICAL gating; [.trivyignore](.trivyignore) documented exceptions; weekly stale-entry review via [.github/workflows/trivyignore-review.yml](.github/workflows/trivyignore-review.yml). Confirmed ACTIVE by 2026-05-17 Stage X.2 intake (was incorrectly DEFERRED). |
| Web security headers (CSP/HSTS/etc.) | DEFERRED | (Standing Backlog: helmet in api/src/main.ts + Playwright spec at Stage 5 - HIGHEST-LEVERAGE NEW GAP per 2026-05-17 intake; slate for Phase N3 design start) |
| SBOM generation + signing | DEFERRED | (Standing Backlog: syft + cosign at Stage 6) |
| SAST (semgrep / CodeQL) | 1 (CI) | **ACTIVE via [CodeQL](https://github.com/github/codeql-action)** with `security-extended` + `security-and-quality` query packs ([.github/workflows/codeql.yml](.github/workflows/codeql.yml)); weekly + per-PR + push schedule. Confirmed ACTIVE by 2026-05-17 Stage X.2 intake (was incorrectly DEFERRED). semgrep optional supplement, not a replacement. |
| GHA action SHA pinning | 6 (CI) | **ACTIVE** - all `uses:` lines in all 5 workflow files SHA-pinned with `# vX.Y.Z` tag comment. Verified by 2026-05-17 Stage X.2 intake. Branch protection + GHA OIDC for Azure deploys remain DEFERRED. |
| CORS hardening on API | 3b.4 | **PARTIAL** - configurable via `CORS_ORIGIN` env var ([api/src/security/cors-origin.ts](api/src/security/cors-origin.ts)); default is `true` (allow-all) for backward-compat. Production deployments MUST set explicit allowlist. |
| Cryptographic deprecation watch | X.2 Category 4 | `securityBestPracticesIntake` |
| AI/LLM security (when Phase N+ adds LLM features) | X.2 Category 10 | `securityBestPracticesIntake` |
| HTTP rate limiting (per-IP / per-endpoint) | DEFERRED | (Standing Backlog: `@nestjs/throttler` at Stage 1 - apply at Phase N3 if telemetry endpoint introduces a new unauthenticated surface; broader API rate-limit deferred to Phase O) |
| Secret rotation cadence (operational) | DEFERRED | (Standing Backlog: rotate `SCIM_SHARED_SECRET`, `JWT_SECRET`, `OAUTH_CLIENT_SECRET` quarterly; track dates in a runbook) |

When `securityBestPracticesIntake` (X.2) recommends moving any DEFERRED item to an active gate, this map MUST be updated in the same commit.

### Prod Promotion (separate, on-demand only)
- **Customer-facing prod (calmsand) is NEVER automatic.** Only when the user explicitly requests via `deployAndPromote` prompt or manual `pwsh scripts/promote-to-prod.ps1`.
- **Auto-canary carve-out (parallel prod / proudbush, SAME tenant as dev):** `dev-deployment-pipeline.ps1 -AutoCanary` MAY auto-promote a dev-validated image to proudbush as a true blue/green canary (Stage 6.5), because proudbush shares the dev tenant and the operator does not worry about its traffic. The auto-canary is guarded: it is BLOCKED if there is any FAIL gate, any SKIPPED gate, a change-freeze file `scripts/.deploy-freeze`, or the kill switch env `SCIMSERVER_AUTOCANARY_DISABLE`. A blocked canary falls back to the manual prompt. calmsand is NEVER auto-promoted - its ingress is flipped only after the proudbush canary is proven green AND the operator gives an explicit `promote to prod`.
- **Canary-first invariant:** the ingress / traffic-routing change (switch from `latestRevision` auto-routing to named-revision weighted routing) MUST be proven on proudbush BEFORE it is applied to calmsand. Never roll an unproven ingress change to the customer-facing prod first.
- **True blue/green:** `promote-to-prod.ps1 -BlueGreen` pins blue by revision name (100%), creates green at 0%, soaks the `--green` label FQDN, runs `verify-deployment.ps1` (live SCIM + Playwright + data/ID before-after diff) on green, flips to green only on pass, re-verifies the public FQDN, and auto-rolls-back on any failure. Customers stay on blue throughout. Legacy auto-flip (no `-BlueGreen`) remains the default for backward compat but has no 0% soak.
- **Expected canary-ahead window:** after an auto-canary run, proudbush will intentionally be one version AHEAD of calmsand until the operator approves the calmsand promote. This drift is EXPECTED and must NOT be flagged as the v0.52.3-style stale-prod mistake. The stale-prod rule applies only when a MANUAL dual-promote leaves one behind unintentionally.
- Prod promotion requires Stage 4.4 (dev live tests) green on the exact image SHA being promoted, not the "latest" tag.

### Deployment Topology (CURRENT - corrected 2026-05-29 post-promote)

There are TWO live prod instances + one dev. The earlier 2026-05-29 doc-update incorrectly marked calmsand as RETIRED; it is in fact the customer-facing prod and was just promoted to v0.52.3 alongside the proudbush instance.

| Environment | App Name | Resource Group | Subscription | OAuth Secret | SCIM Shared Secret (E2E_TOKEN) | FQDN | Container Registry |
|---|---|---|---|---|---|---|---|
| **Prod (CUSTOMER-FACING)** | `scimserver-prod` | `scimserver-rg-prod` | `AnandSa-Test-150` | `changeme-oauth` | `changeme-scim` | `scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io` | `ghcr.io/pranems/scimserver` (anonymous pull) |
| **Prod (parallel, eastus)** | `scimserver` | `scimserver-prod` | `ProvIAM_Subscription` | `changeme-oauth` | `changeme-scim` | `scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io` | `acrscimserver20622.azurecr.io` + `ghcr.io/pranems/scimserver` |
| **Dev** | `scimserver-dev` | `scimserver-dev` | `ProvIAM_Subscription` | `changeme-oauth` | `changeme-scim` | `scimserver-dev.proudbush-ae90986e.eastus.azurecontainerapps.io` | `acrscimserver20622.azurecr.io` + `ghcr.io/pranems/scimserver` |

**Customer-facing prod (calmsand, centralus, AnandSa-Test-150 sub):**
- App `scimserver-prod` / RG `scimserver-rg-prod` / FQDN `scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io`
- Running real workloads (Ryan-Gruss, Ryan-Eakins, OpenText-* ISVs, 2,000+ users)
- Uses GHCR image pulls (anonymous; public path)
- Multiple revision mode with `latestRevision: True, weight: 100` (auto-routes to newest)
- **Separate Azure AD tenant** `9de357c6-4488-4a8d-bd2f-14696f1af950` (not the ProvIAM `f08e6aff-...` tenant) - requires its own `az login` before promotion
- Promotion target: `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-rg-prod -ProdAppName scimserver-prod -ImageTag <version> -Subscription AnandSa-Test-150` (requires `az login` into the AnandSa tenant then `az account set --subscription AnandSa-Test-150` first; pass `-ImageTag` explicitly - dev app is in the other tenant)

**Parallel prod (proudbush, eastus, ProvIAM_Subscription):**
- App `scimserver` / RG `scimserver-prod` (different from calmsand's `scimserver-rg-prod`) / FQDN `scimserver.proudbush-ae90986e.eastus.azurecontainerapps.io`
- Uses ACR image (`acrscimserver20622.azurecr.io/scimserver:<sha>`) with Managed Identity pull; lower cold-start latency
- Same SCIM contract surface; both are kept in lockstep version-wise
- Promotion target: `pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag <version>` (in `ProvIAM_Subscription`)

**Important when promoting prod:** ALWAYS canary-first - promote proudbush (same-tenant parallel prod) FIRST with `-BlueGreen -RunVerification -VerifyPlaywright`, prove it green, and ONLY THEN promote calmsand (after explicit operator go-ahead). If the operator says "promote to prod" without naming which one, promote proudbush as the canary and ask for confirmation before calmsand. Both deserve the same image. An UNINTENTIONAL single-prod promotion that leaves the other behind is the v0.52.3 mistake of 2026-05-29 (proudbush got v0.52.3 first; calmsand left on v0.52.2 until the operator surfaced it). Note: an auto-canary run intentionally leaves proudbush ahead until the calmsand go-ahead - that drift is expected, not the v0.52.3 mistake.

**CRITICAL - the two prods live in DIFFERENT Azure AD tenants.** Dev + parallel prod (proudbush) are in `ProvIAM_Subscription`, tenant `f08e6aff-ca0f-4f11-81fa-1ffd43323373`. Customer-facing prod (calmsand) is in `AnandSa-Test-150`, a **separate tenant** `9de357c6-4488-4a8d-bd2f-14696f1af950` (distinct from the ProvIAM tenant). Consequences for promotion:
- You **cannot** promote both prods in a single `az` session. You must re-auth / switch context between them. Promote proudbush + dev work under the ProvIAM tenant; promoting calmsand requires `az login` into the AnandSa tenant first, then `az account set --subscription AnandSa-Test-150`.
- The calmsand tenant **cannot pull from the ProvIAM-tenant ACR** (`acrscimserver20622.azurecr.io`) - cross-tenant ACR pull would need cross-tenant credentials. That is WHY calmsand pulls the image anonymously from **GHCR** (`ghcr.io/pranems/scimserver`). The publish step MUST push to GHCR (`publish-ghcr.yml`) before a calmsand promotion, not only ACR.
- For the calmsand promotion always pass `-ImageTag <version>` explicitly. Do NOT let `promote-to-prod.ps1` auto-read the tag from the dev app - the dev app is in the OTHER tenant and would not be reachable in the active (AnandSa) `az` context.
- Promotion commands (run in the matching tenant context for each):
  ```powershell
  # proudbush parallel prod + dev (ProvIAM tenant - usually already the active context)
  az account set --subscription ProvIAM_Subscription
  pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-prod -ProdAppName scimserver -ImageTag <version>

  # calmsand customer-facing prod (separate AnandSa tenant - MUST re-login)
  az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950
  az account set --subscription AnandSa-Test-150
  pwsh scripts/promote-to-prod.ps1 -ProdResourceGroup scimserver-rg-prod -ProdAppName scimserver-prod -ImageTag <version> -Subscription AnandSa-Test-150
  ```

### Deployment Topology (HISTORICAL - retired)

These deployments are retired and not live. Any tooling, doc, or script reference to these FQDNs / app names / RGs should be treated as historical context, not a deployment target.

| Era | App Name | Resource Group | FQDN | Status |
|---|---|---|---|---|
| Tenant-migration era (pre-2026-05-19) | `scimserver2` | `scimserver-rg` | `scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io` | RETIRED (mgmt-plane expired during 2026-05-19 cross-tenant migration; data-plane was read-only during the migration window) |
| Pre-tenant-migration dev | `scimserver-dev` | `scimserver-rg-dev` | `scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io` | RETIRED (same tenant-migration cutover) |

**Image registry note:** the runtime registry for the parallel proudbush prod + dev is Azure Container Registry (`acrscimserver20622.azurecr.io`); the customer-facing calmsand prod pulls from GitHub Container Registry (`ghcr.io/pranems/scimserver`, anonymous pull). Both publish the same image per commit (CI workflow [publish-ghcr.yml](.github/workflows/publish-ghcr.yml) + local `docker push` to ACR). The documented public path remains `docker pull ghcr.io/pranems/scimserver:latest` and `pwsh bootstrap.ps1 -> setup.ps1 -> deploy-azure.ps1` - see [DEPLOYMENT.md](DEPLOYMENT.md).

**Live Test Conventions:**
- New sections go before TEST SECTION 10 (DELETE OPERATIONS / Cleanup)
- Use sequential section numbering (e.g., `9l`, `9m`, `9n`, ...)
- Set `$script:currentSection` for result tracking
- Create dedicated test resources, verify behavior, then clean up at end of section
- Test all CRUD operations plus edge cases (e.g., `?attributes=` override attempts for returned:never)
- Follow existing patterns: `Test-Result -Success <bool> -Message <string>`, `Invoke-RestMethod`, `$scimBase`, `$headers`

### Gate-Strategy Self-Improvement Loop
After every commit that exposes a new bug class (parity gap, prompt-injection vector, RFC ambiguity, test-rot pattern, etc.), update THIS section to add the corresponding gate. The formal engine for this loop is `gateStrategySelfAudit` (Stage X.1) for general drift and `securityBestPracticesIntake` (Stage X.2) for security-landscape changes. Manual updates here are still valid for fast-turn cases; both prompts aggregate them on their periodic runs.

Examples of standing rules that originated from real failures:
- **Schema-Characteristic Test Rule** (May 2026 Group.displayName uniqueness flip) - added a helper module + standing rule about always going through `expectCharacteristicIn` / `Get-EffectiveUniqueness`.
- **Stage 2.5 + Stage 2.6 cross-backend parity** (May 2026 Finding-B inmemory parity) - elevated `test-all-modes.ps1` from optional to mandatory AND added the `crossBackendParityAudit` prompt as the thinking discipline that complements the orchestrator.
- **Stage 5.2 Playwright spec hygiene** (May 2026 Finding-C 121-fail false signal) - added the `playwrightSpecHygieneAudit` prompt; explicit guidance that legacy-UI spec failures are tests-to-delete, not gates-to-lower.
- **Stage 1.8 bundleBudgetAudit** (Phase K1/L1/M1 manual budget-add discipline) - codified the "every new lazy route = new size-limit entry" workflow that was manual until v0.52.x.
- **Stage 1.9 prismaMigrationAudit** (cross-cutting CD concern) - codified the pre-commit check that `schema.prisma` + `migrations/` + InMemory repos stay in lockstep.
- **Stage 3b.3 endpointConfigFlagAudit** (codebase-specific 14-flag architectural element) - the 10-cell completeness matrix prevents the "added a flag but forgot the doc / UI / live test" bug class.
- **Stage 3b.5 dependencyCveSweep** (CVE freshness discipline separate from feature-driven `securityAudit`) - triggered by `package.json` changes + weekly schedule; Critical/High blocks commits.
- **Stage 3c.1 codeReviewSelfAudit** (May 2026 Design Deep Analysis precedent: SchemaValidator god class 1,467 lines, service-helpers Swiss army 1,230 lines) - scoped to CHANGED files only; output is suggestions not blocks; catches god-class growth, helper-bloat, naming drift.
- **Stage X.1 gateStrategySelfAudit** (May 2026 meta-audit need) - formal proactive engine for THIS loop. 4 trigger types (release / monthly / on-demand / incident-driven). Replaces ad-hoc reactive updates with structured introspection.
- **Stage X.2 securityBestPracticesIntake** (May 2026 security-intake gap) - dedicated security-landscape scan across 10 categories with URL-citation enforcement. Separated from X.1 so security depth is not diluted by general drift. Pairs with the Cross-Cutting Security Gate Map to make threading visible.
- **First Stage X.2 run (2026-05-17)** - meta-audit caught 4 Standing Backlog items as ALREADY ACTIVE (Dependabot, GHA SHA pinning, Trivy, CodeQL) + 1 standing-rule node-version drift (node:25 -> node:24 in the lockfile-regen rule) + 9 new DEFERRED items (helmet, rate limiting, hard-delete, MI, secret rotation, npm audit-signatures, OpenSSF Scorecard, CODEOWNERS, DPoP). 3 actionable prompt amendments (R1 OWASP API v2023 + R2 RFC 9700 + RFC 7644 §7 + R3 EU AI Act categories) shipped inline. Highest-leverage NEW gap is API HTTP security headers (helmet); slate for Phase N3 design start. Full report: [docs/strategy/SECURITY_INTAKE_2026-05-17.md](docs/strategy/SECURITY_INTAKE_2026-05-17.md).

### Standing Backlog (recommendations for future evolution; not blockers)

**Strategy / process:**
- **`backwardCompatAudit` prompt** - "does this change break a previously-published contract?" Currently partially covered by `apiContractVerification`. Would specialize on public-contract diffing between commits. Worth scoping after the next public-contract-breaking incident provides design constraints.
- **CI-time runner for Stage X.1 + X.2** - both prompts are currently operator-invoked. A scheduled GitHub Actions runner on the 1st of each month would automate Trigger B (calendar) for both.
- **Auto-creation of `docs/strategy/*_<date>.md`** - X.1 and X.2 outputs are structured Markdown; a small script could open a PR with the report attached, surfacing findings to reviewers without requiring an operator to run the prompt.

**Security tool gates (active vs deferred; 2026-05-17 Stage X.2 intake reconciliation):**

*Already ACTIVE (moved from DEFERRED after first Stage X.2 intake):*
- **Stage 1 SAST gate** - ACTIVE via [CodeQL](https://github.com/github/codeql-action) `security-extended` + `security-and-quality` packs ([.github/workflows/codeql.yml](.github/workflows/codeql.yml)); weekly + per-PR. semgrep optional supplement.
- **Stage 4 container CVE scan** - ACTIVE via [trivy](https://github.com/aquasecurity/trivy) in `build-and-push.yml` + `build-test.yml`; HIGH+CRITICAL gating; `.trivyignore` documented; weekly stale-entry review.
- **Repo policy: Dependabot weekly** - ACTIVE via [.github/dependabot.yml](.github/dependabot.yml); npm/api + npm/web + github-actions + docker ecosystems.
- **Stage 6 GHA action SHA pinning** - ACTIVE; all `uses:` lines SHA-pinned with `# vX.Y.Z` tag comment.

*Still DEFERRED (tool not installed OR cost > value at current scale):*
- **Stage 4 SBOM generation** - [syft](https://github.com/anchore/syft) generates an SPDX SBOM at build time; enables post-deploy CVE lookup; near-zero overhead. Slate for v0.52.0 stable rollup.
- **Stage 5 web security headers gate** - new Playwright spec asserts presence + value of `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` (or CSP `frame-ancestors`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` on every public response; locks CSP/HSTS as code. **HIGHEST-LEVERAGE NEW GAP per 2026-05-17 intake** - slate for Phase N3 design start (helmet middleware in api/src/main.ts + E2E spec).
- **Stage 6 image signing** - [cosign](https://github.com/sigstore/cosign) keyless OIDC signs the image after build; verifies image came from our CI.
- **Repo policy: signed commits + branch protection require SHA pinning** - GPG-signed commits, required PR review, no force-push to `main` / `feat/*`.
- **Migration to distroless or rootless base image** - currently node:24-alpine running as `nestjs` user UID 1001 (rootless already); evaluate distroless Node image as a further hardening step (smaller attack surface, no shell). Cost > value at current scale; harder live-debug.
- **CORS default tighten** - parseCorsOrigin allows `CORS_ORIGIN` env override but defaults to `true` (allow-all). Production deployments MUST set explicit allowlist; consider flipping the default to deny in v1.0.
- **API HTTP rate limiting** - `@nestjs/throttler` at the per-endpoint level. Apply at Phase N3 if telemetry endpoint introduces a new unauthenticated surface; broader deferral to Phase O.
- **Rotate long-lived secrets quarterly** - `SCIM_SHARED_SECRET`, `JWT_SECRET`, `OAUTH_CLIENT_SECRET`; track rotation dates in a runbook. Operational policy, no code change.
- **GDPR Article 17 hard-delete admin path** - we currently soft-delete; for subject-erasure requests an admin hard-delete endpoint is needed. Defer until first subject request lands.
- **Migrate Azure Postgres auth to Managed Identity** - removes long-lived secret. Slate for Phase O.
- **Enable `npm ci --audit-signatures` in CI** - blocks compromised-package class; ~5 sec per CI run.
- **OpenSSF Scorecard scheduled scan** - 5 min to add; gives a single metric for repo security posture.
- **CODEOWNERS for security-sensitive paths** - `api/src/security/`, `infra/`, `.github/workflows/`. Useful when team grows past 1 reviewer.
- **DPoP (RFC 9449) for endpoint credentials** - sender-constrained tokens; tightens our bearer-token model. Low priority at current scale.

**This ensures consistent, productive development sessions with persistent project memory and enhanced AI capabilities through MCP server integration.**