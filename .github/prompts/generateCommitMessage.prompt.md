---
name: generateCommitMessage
description: Analyze current git changes and generate a structured commit message prioritizing code over docs.
argument-hint: Optional commit type override (e.g. "feat", "fix", "refactor", "chore") or scope hint.
---

Generate a well-structured, accurate commit message for the current staged and unstaged changes. Prioritize **code changes** (source, tests, config) over documentation and metadata changes.

---

## Step 1 - Gather Changes

1. **Get all changed files**: Use `get_changed_files` to retrieve diffs for staged and unstaged changes.
2. **Read context**: Read `package.json` for current version and `CHANGELOG.md` for the latest version entry to understand the release context.
3. **Read session context**: Check `Session_starter.md` for the current phase/feature being worked on.

---

## Step 2 - Classify Changes

Group every changed file into one of these categories, in **priority order**:

| Priority | Category | File patterns | Examples |
|----------|----------|---------------|----------|
| 1 | **Source code** | `api/src/**/*.ts` (non-spec) | Services, controllers, guards, DTOs, utilities, modules |
| 2 | **Tests - Unit** | `api/src/**/*.spec.ts` | Service specs, controller specs, utility specs |
| 3 | **Tests - E2E** | `api/test/e2e/*.e2e-spec.ts` | Integration/E2E specs |
| 4 | **Tests - Live** | `scripts/live-test.ps1` | Live integration test sections |
| 5 | **Configuration** | `*.json`, `*.config.*`, `*.yml`, `Dockerfile*`, `*.bicep` | package.json, tsconfig, docker-compose, jest config, Prisma schema |
| 6 | **Documentation** | `docs/**/*.md`, `*.md` (root), `.github/**/*.md` | Feature docs, README, CHANGELOG, prompts |
| 7 | **Scripts & Infra** | `scripts/**`, `infra/**`, `*.ps1`, `*.sh` | Deploy scripts, setup scripts, Bicep templates |
| 8 | **Other** | Everything else | Assets, generated files, lock files |

For each category with changes, note:
- Number of files changed
- Brief summary of what changed (not line-by-line - semantic summary)
- Whether it's a new file, modification, or deletion

---

## Step 3 - Determine Commit Type

Based on the changes, select the appropriate conventional commit type:

| Type | When to use |
|------|-------------|
| `feat` | New feature or capability added |
| `fix` | Bug fix or correction |
| `refactor` | Code restructuring without behavior change |
| `test` | Test-only changes (new tests, test fixes) |
| `docs` | Documentation-only changes |
| `chore` | Build, config, dependency, or tooling changes |
| `perf` | Performance improvement |
| `style` | Formatting, whitespace, naming (no logic change) |

If changes span multiple types, use the **highest-impact type** (usually `feat` or `fix`).

---

## Step 4 - Generate Commit Message

Follow this format:

```
<type>(<scope>): <subject line - max 72 chars>

<body - what changed and why, grouped by priority>

<footer - breaking changes, issue refs, test counts>
```

### Rules

1. **Subject line**: Imperative mood ("add", "fix", "refactor"), max 72 characters, no period at end.
3. **Scope**: The primary module or feature affected (e.g., `scim`, `bulk`, `projection`, `G8g`, `etag`, `admin`, `config`, `tests`, `docs`, `log-config`, `credentials`, `me`, `activity`, `database`).
3. **Body**: Organized by priority category. Lead with code changes. Use bullet points. Keep each bullet to one line.
4. **Code changes first**: Always list source code changes before test changes, and test changes before doc changes.
5. **Test counts**: If tests were added/changed, include delta counts: `Tests: +X unit, +Y E2E, +Z live`.
6. **Version**: If `package.json` version changed, mention it: `Version: v0.X.Y → v0.X.Z`.
7. **No filler**: No "minor tweaks", "various improvements", or "updated files". Be specific.

### Example Output

```
feat(projection): add write-response attribute projection on POST/PUT/PATCH

Source:
- Add ?attributes= and ?excludedAttributes= query params to all 6 write controller methods
- Replace 6 inline returned:request stripping loops with applyAttributeProjection() calls
- Ensure always-returned fields (id, schemas, meta, userName) survive excludedAttributes

Tests:
- +12 unit tests in users controller spec (projection on POST/PUT/PATCH)
- +11 unit tests in groups controller spec (projection on POST/PUT/PATCH)
- +14 E2E tests in attribute-projection.e2e-spec.ts (write-response projection)
- +33 live test assertions in section 9p (write-response projection)

Docs:
- Add docs/G8G_WRITE_RESPONSE_ATTRIBUTE_PROJECTION.md with architecture, examples, test tables
- Update docs/INDEX.md with G8g entry
- Update CHANGELOG.md with v0.19.2 entry

Tests: +23 unit, +14 E2E, +33 live
Version: v0.19.1 → v0.19.2
```

---

## Step 5 - Output

Present the commit message in a fenced code block ready to copy-paste. Also provide:

1. **One-liner** version (just the subject line) for quick commits
2. **Full version** (subject + body + footer) for detailed commits
3. **Files summary**: Total files changed, insertions, deletions (from diff stats)

---

## Step 6 - Self-Update This Prompt

After generating the commit message, review **this prompt itself** for improvements:

1. **New file categories**: If new file types or directories appeared in the project that don't fit the current classification table (Step 2), add them.
2. **New commit types**: If the project adopted new conventional commit types or scopes, update Step 3's table.
3. **Format changes**: If the team's commit message conventions changed (e.g., different subject line length, different footer format, Jira/ADO ticket references), update Step 4's rules.
4. **New context files**: If the project added new context sources beyond `package.json`, `CHANGELOG.md`, and `Session_starter.md`, add them to Step 1.
5. **Example staleness**: If the example commit message references outdated features or version numbers, update it to reflect a recent real commit.
6. **Scope list**: If new modules or features were added that should be valid scopes, add them to the scope guidance.
7. **Priority order**: If the team decided certain change types should be prioritized differently (e.g., security fixes above features), update the priority table.

Apply updates directly to this file (`.github/prompts/generateCommitMessage.prompt.md`) so future runs remain accurate.
