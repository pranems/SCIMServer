---
name: sessionWrapUp
description: End-of-session bookkeeping - update Session_starter.md, DELIVERY_PLAN progress log, CHANGELOG, and version references.
argument-hint: Optional summary of what was accomplished this session (auto-detected from git log if omitted).
---

Perform all end-of-session documentation updates to maintain project continuity across sessions.

---

## Step 1 - Gather Session Activity

1. Get commits made during this session:
   ```powershell
   git log --oneline --since="8 hours ago"
   ```
2. Read current `api/package.json` version
3. Get current test counts by running:
   ```powershell
   npx jest --silent 2>&1 | Select-String "Tests:.*passed"
   ```
4. Check deployment state:
   - Dev image: `az containerapp show --name scimserver-dev --resource-group scimserver-rg-dev --query "properties.template.containers[0].image" -o tsv`
   - Prod image: `az containerapp show --name scimserver2 --resource-group scimserver-rg --query "properties.template.containers[0].image" -o tsv`
5. If user provided a summary argument, use it. Otherwise, generate from git log.

---

## Step 2 - Update Session_starter.md

Add a new row to the update log table in `Session_starter.md`:

```markdown
| <today's date> | <summary of work done> **Validation: <unit count> unit (<suite count> suites), <e2e count> E2E, <live count> live assertions - ALL PASSING.** |
```

Include:
- Feature/fix IDs from DELIVERY_PLAN (e.g., "UI-B1", "S-4", "OPS-5")
- Commit SHAs for key changes
- Test count changes (if tests were added)
- Deployment activities (if image was published/promoted)

---

## Step 3 - Update DELIVERY_PLAN.md Progress Log

Add entries to the Progress Log table in `docs/DELIVERY_PLAN.md` S11:

```markdown
| <date> | <commit SHA prefix> | <defect IDs closed> | <summary> |
```

For each defect ID that was completed this session, also mark it in the relevant S3 inventory table if there's a "Status" column.

---

## Step 4 - Update CHANGELOG.md (if version bumped)

If the `package.json` version changed during this session, add a new CHANGELOG entry:

```markdown
## [<version>] - <date>

### Added
- <new features>

### Fixed
- <bug fixes>

### Changed
- <modifications>

### Security
- <security fixes>

### Tests
- Unit: <count> (<suites> suites)
- E2E: <count> (<suites> suites)
- Live: <count> assertions
```

---

## Step 5 - Version Bump Check

If significant changes were made but `package.json` version was NOT bumped:
- Bug fixes only: suggest patch bump (e.g., 0.40.0 -> 0.40.1)
- New features: suggest minor bump (e.g., 0.40.0 -> 0.41.0)
- Breaking changes: suggest major bump

Ask the user if they want to bump. If yes, update `api/package.json` version.

---

## Step 6 - Final Commit

If any files were updated in Steps 2-5:
```powershell
git add -A
git commit -m "docs: session wrap-up - update Session_starter.md, DELIVERY_PLAN progress log, CHANGELOG"
git push origin HEAD:master
```

---

## Step 7 - Session Summary

Output a concise summary:

```
## Session Summary - <date>

**Duration:** ~Xh
**Commits:** N commits
**Defects Closed:** <list of IDs>
**Tests:** <unit> unit, <e2e> E2E, <live> live (delta: +X unit, +Y live)
**Deployments:** Dev v<X>, Prod v<Y>
**Next Up:** <next item from DELIVERY_PLAN>
```

---

## Self-Improvement

After each wrap-up, note:
- Files that were forgotten and had to be updated manually later
- New files that should be part of the wrap-up checklist

<!-- Wrap-Up History -->
<!-- (populated after first run) -->
