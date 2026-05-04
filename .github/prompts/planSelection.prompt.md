---
name: planSelection
description: Read DELIVERY_PLAN.md, identify the next open work item by priority, and output structured context for implementation.
argument-hint: Optional filter - "security", "ops", "ui-backend", "ui-frontend", or a specific defect ID like "UI-B1".
---

Identify the next work item from the canonical delivery plan and prepare structured implementation context.

---

## Step 1 - Load Plan and Current State

1. Read `docs/DELIVERY_PLAN.md` fully - focus on:
   - S3: Named defect inventory (all tables in S3.1 through S3.6)
   - S6: Week-by-week Gantt (which week are we in?)
   - S7: TDD process rules
   - S11: Progress log (what's already done?)
2. Read `Session_starter.md` for current session state and recent work.
3. Read `CHANGELOG.md` for the latest version entry.
4. Check `api/package.json` for current version.

---

## Step 2 - Determine Next Item

Scan the defect inventory tables in order:

| Priority | Section | Category |
|----------|---------|----------|
| 1 | S3.1 | Tier-0 Security + Data Integrity (MUST before any deploy) |
| 2 | S3.2 | Tier-0 CI/CD (MUST before any deploy) |
| 3 | S3.3 | Operational Safety (Week 1-2) |
| 4 | S3.4 | Operational (Week 2) |
| 5 | S3.5 | UI Backend BFF (Weeks 2-3) |
| 6 | S3.6 | UI Frontend (Weeks 3-6) |

For each item, check:
- Is it already marked done in the Progress Log (S11)?
- Is there a commit referenced for it?
- If user provided an argument filter, narrow to that category.

Select the **first open item** by priority.

---

## Step 3 - Output Structured Context

Output a structured block with:

```
## Next Work Item

**ID:** <defect ID, e.g. UI-B1>
**What:** <one-line description from the plan>
**Hours:** <estimated hours>
**Done When:** <acceptance criteria from the plan>
**Files to Touch:** <file paths from the plan>
**Week:** <which week this belongs to>
**Dependencies:** <any predecessor items that must be done first>

## TDD Approach (from DELIVERY_PLAN S7)
1. Write failing test (Red)
2. Implement minimal code (Green)
3. Refactor
4. Commit with defect ID in message

## Suggested Branch Name
<type>/<defect-id-kebab> (e.g. feat/ui-b1-shared-types)

## Commit Message Template
<type>(scope): <subject> (<defect-ID>)
```

---

## Step 4 - Check for Blockers

Before recommending the item, verify:
- All predecessor items are complete (check Progress Log)
- Required infrastructure exists (e.g., dev deployment for Azure-dependent items)
- No open PRs that would conflict

If blockers exist, skip to the next open item and note the blocker.

---

## Step 5 - Self-Improvement

After each run, append any new patterns to this prompt:
- Items that were blocked and why
- Ordering corrections (items that should have been done earlier)
- New categories of work not in the current plan

<!-- Execution History -->
<!-- (populated after first run) -->
