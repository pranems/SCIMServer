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

## Git Commit Rules (CRITICAL)
- NEVER use `git commit --amend` unless explicitly specified by the user - always create new commits with `git commit -m "..."`
- NEVER rewrite history on commits that have been pushed
- Always use `git add -A; git commit -m "<descriptive message>"` for saving progress

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

## Feature / Bug-Fix Commit Checklist (Standing Rule)

Every feature or significant change commit MUST include ALL of the following before committing. Do NOT skip any item:

1. **Unit Tests** - Service-level (`.service.spec.ts`) and Controller-level (`.controller.spec.ts`) tests covering the new behavior
2. **E2E Tests** - End-to-end spec (`test/e2e/*.e2e-spec.ts`) exercising the feature through HTTP
3. **Live Integration Tests** - New test section in `scripts/live-test.ps1` covering the feature for all deployment scenarios (local server on port 6000, Docker container on port 8080, Azure). Must be runnable with both `.\live-test.ps1` (local) and `.\live-test.ps1 -BaseUrl http://localhost:8080 -ClientSecret "changeme-oauth"` (Docker)
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
4.4. **Dev Azure deploy + live tests** - Publish image with current commit SHA tag, deploy to `scimserver-dev` Azure Container App, run `pwsh scripts/live-test.ps1 -BaseUrl https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io -ClientSecret "changeme-oauth"` -> all current-baseline tests pass (current: 984+ assertions). **This is the sub-phase gate the commit message names.**

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
- External claims require URL citations (no URL = "speculative — verify before action").
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
| Web security headers (CSP/HSTS/etc.) | 1.2 (build) + 2.1 (unit) + 2.2 (E2E) | **ACTIVE (Phase N3a, v0.52.0-alpha.3, 2026-05-18)** via helmet@^8.1.0 in [api/src/security/helmet-config.ts](api/src/security/helmet-config.ts) + wired in both [api/src/main.ts](api/src/main.ts) and [api/test/e2e/helpers/app.helper.ts](api/test/e2e/helpers/app.helper.ts) (drift-prevention). Unit lock via [api/src/security/helmet-config.spec.ts](api/src/security/helmet-config.spec.ts) (7 tests). E2E lock via [api/test/e2e/security-headers.e2e-spec.ts](api/test/e2e/security-headers.e2e-spec.ts) (11 tests across 4 probe routes covering CSP/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/COOP/CORP/Origin-Agent-Cluster/X-Permitted-Cross-Domain-Policies/X-DNS-Prefetch-Control/X-Download-Options + HSTS-absent-in-test + COEP-absent + Permissions-Policy-present). Stage 4 live SCIM header lockdown + Stage 5 Playwright `web/e2e/security-headers.spec.ts` vs dev FQDN deferred to a follow-up commit pair. |
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
- **NEVER automatic.** Only when the user explicitly requests via `deployAndPromote` prompt or manual `pwsh scripts/promote-to-prod.ps1`.
- Prod promotion requires Stage 4.4 (dev live tests) green on the exact image SHA being promoted, not the "latest" tag.

### Deployment Topology
| Environment | App Name | OAuth Secret | FQDN |
|-------------|----------|-------------|------|
| Dev | `scimserver-dev` (scimserver-rg-dev) | `changeme-oauth` | `scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io` |
| Prod | `scimserver2` (scimserver-rg) | `changeme-oauth` | `scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io` |

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
- **Stage 5 web security headers gate** - new Playwright spec asserts presence + value of `Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options` (or CSP `frame-ancestors`), `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` on every public response; locks CSP/HSTS as code. **Server-side helmet middleware SHIPPED in Phase N3a (v0.52.0-alpha.3, 2026-05-18)**; this remaining Playwright spec is the wire-level lock against dev FQDN + the cross-cutting `web/e2e/security-headers.spec.ts` partner that locks the same header set from the browser side. Slate for the Phase N3a Stage 5 follow-up commit.
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

**Test-design / Playwright (2026-05-18 Stage 5 retroactive closure):**
- **Dashboard visual-regression mask gap** - [web/e2e/visual-regression.spec.ts](web/e2e/visual-regression.spec.ts) `NON_DETERMINISTIC_SELECTORS` covers `server-uptime` + `current-time` + `dashboard-chart svg` + `logs-row-time` but does NOT cover live KPI counts (endpoint count, user count, group count) or endpoint-grid card contents that legitimately drift with tenant data accumulation. Result: `Dashboard (light theme)` + `Dashboard (dark theme)` are intermittently flaky vs dev (pass-fail-pass without source changes). Fix: add testid-driven masks for `[data-testid^="kpi-"]` + `[data-testid="endpoint-grid"]` + `[data-testid="activity-list"]`. Slate for a Stage 5-hygiene mini-commit; not blocking.
- **`web/e2e/new-ui.spec.ts` standing-rule clarification** - the Stage 5.2 instruction to delete this file is overzealous; the file's asserted testids (`app-shell` / `app-header` / `app-sidebar` / `theme-toggle` / `sidebar-toggle` / `kpi-row` / `endpoint-grid`) all still exist in current source post-Phase-I. The file is name-legacy but content-current. Either rename to `app-shell.spec.ts` (clearer intent) or amend the Stage 5.2 "delete list" in the strategy doc to remove `new-ui`. Low priority; documented to prevent future operators acting on the stale instruction.

**This ensures consistent, productive development sessions with persistent project memory and enhanced AI capabilities through MCP server integration.**