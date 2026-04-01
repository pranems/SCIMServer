You are updating the project health and statistics report for SCIMServer.

## Target Document
- **Output file:** `docs/PROJECT_HEALTH_AND_STATS.md`

## Instructions

Perform a comprehensive audit of the current workspace and update the project health document with fresh, accurate data. Do NOT use cached values from the existing document — re-measure everything.

### 1. Codebase Statistics
Run these measurements against git-tracked files (excluding `node_modules`, `dist`, `.git`, `coverage`):

```powershell
# Total tracked files
git ls-files | Measure-Object -Line

# Files by extension
git ls-files | Select-String '\.' | ForEach-Object { [System.IO.Path]::GetExtension($_.Line) } | Group-Object | Sort-Object Count -Descending | Format-Table Count, Name

# Source vs test TS files
git ls-files -- "*.ts" "*.tsx" | Select-String -NotMatch "spec|test" | Measure-Object -Line
git ls-files -- "*.ts" "*.tsx" | Select-String "spec|test" | Measure-Object -Line
```

### 2. Lines of Code — Categorized
Count lines for each category by piping file lists to `Get-Content | Measure-Object -Line`:

- **Source TypeScript** (non-test `.ts`/`.tsx`)
- **Test TypeScript** (files matching `spec|test`)
- **By area:** SCIM Module (`modules/scim`), Web/UI (`web/`), Domain (`domain`), Infrastructure (`infrastructure`), Scripts (`scripts/`, `*.ps1`), Prisma/DB (`prisma`), Other
- **SCIM sub-areas:** Controllers, Services, Filters, DTOs, Other
- **Domain sub-areas:** Validation, Repository, Types, Schema, Other
- **Test types:** Unit (`.spec.ts`), E2E (`.e2e-spec.ts` or `e2e`), Live (PowerShell scripts)
- **Other categories:** Markdown, JSON/YAML/Config, HTML, CSS, Bicep, SQL, Shell

### 3. Module & Component Inventory
- List all NestJS modules: `git ls-files -- "*.module.ts"`
- Count controllers, services, guards: `Select-String '@Controller|@Injectable|@Guard'`
- List Prisma models: `Select-String -Path "api/prisma/schema.prisma" -Pattern "^model "`
- Count exported interfaces, classes, enums
- Identify key domain classes with line counts

### 4. Test Coverage & Quality
- Read latest test results from `api/pipeline-unit.json` and `api/pipeline-e2e.json`
- Count live test assertions from `scripts/live-test.ps1`
- Calculate test-to-source ratios
- Identify test gaps (areas with no or low coverage)

### 5. Dependencies
- Extract from `api/package.json`: `dependencies` and `devDependencies`
- Note version of each key technology (Node, TS, NestJS, Prisma, PostgreSQL, React, Vite, Jest, ESLint)

### 6. Architecture & Design Principles
- Review layered architecture (Transport → API → Service → Domain → Persistence)
- Identify design patterns in use (DI, Repository, Strategy, Guard, Interceptor, Feature Flags)
- Assess SOLID principles adherence
- Note code duplication patterns and symmetries

### 7. Data Model
- Read Prisma schema for current models and relationships
- Note persistence backends and toggle mechanism
- Document key data patterns (JSONB, soft delete, versioning, multi-tenant scoping)

### 8. Deployment & Infrastructure
- List Docker files and their purposes
- List Bicep IaC files
- Note CI/CD workflows
- List automation scripts
- Document deployment targets and resource requirements for different scenarios

### 9. Project Health & Git Stats
```powershell
git log --oneline | Measure-Object -Line          # Commits
git shortlog -sn --no-merges | Measure-Object -Line  # Contributors
git branch -a | Measure-Object -Line              # Branches
git log --reverse --format="%ai" | Select-Object -First 1  # First commit
git log --format="%ai" -1                         # Latest commit
```

### 10. Migration Roadmap
- Check `Session_starter.md` for phase completion status
- Check `docs/MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md` for roadmap
- Note completed phases, current phase, remaining gaps

### 11. Known Issues & Limitations
- Scan for `TODO`, `FIXME`, `HACK` in source code
- Check ESLint error/warning count
- Review known test failures
- Note architectural limitations and technical debt

### 12. Improvement Suggestions
- Compare against best practices for NestJS, SCIM compliance, security
- Identify missing features from RFC 7643/7644
- Suggest operational improvements (health checks, observability, scaling)
- Note potential security concerns

## Output Format
Update `docs/PROJECT_HEALTH_AND_STATS.md` with:
1. Update the `Last Updated` date to today
2. Update the `Version` to match `api/package.json`
3. Replace ALL statistics sections with freshly measured values
4. Update migration progress section
5. Update known issues with any new findings
6. Keep the same document structure and table format

## Quality Checks
After updating:
- Verify all numbers are from fresh measurements (not stale)
- Ensure test counts match latest results files
- Confirm version matches `package.json`
- Check all tables are properly formatted markdown
