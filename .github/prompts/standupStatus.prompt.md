---
name: standupStatus
description: Produce an evidence-based team standup package for a date range - themed bullets, a 30-second spoken script, Done/In Progress/Risks/Next, consolidated work items as a table and as import-ready CSV, plus a single copy-paste block.
argument-hint: "The range, e.g. 'since Aug 19' or 'last 7 days'. Defaults to the last 7 days."
---

Produce a team standup status package for the requested range.

**This is a reporting task, not a delivery task.** Do not fix code, deploy, or change
state. Read-only evidence gathering, then write the report.

---

## Step 1 - Gather evidence. Never reuse a previous report.

A previous standup in this conversation is **not** evidence. Versions, deployed
estates, open items and risks all drift between runs, and a stale claim repeated
confidently is worse than no claim. Re-run every check below, every time.

Run these in parallel where they do not depend on each other.

### 1.1 Repository state

```powershell
git fetch origin --prune
git status --short --branch
git worktree list --porcelain
git log --all --since="<RANGE_START>" --date=iso-strict --pretty=format:"%h%x09%ad%x09%d%x09%s"
```

Then, for **every** worktree, check dirty files and commits not yet on `origin/master`:

```powershell
$worktrees = git worktree list --porcelain | Where-Object { $_ -like 'worktree *' } | ForEach-Object { $_.Substring(9) }
foreach ($p in $worktrees) { "=== $p ==="; git -C $p status --short --branch }
```

Quantify the range:

```powershell
$base = git rev-list -1 --before="<RANGE_START>" origin/master
git diff --shortstat "$base..origin/master"
git log "$base..origin/master" --pretty=format:"=== %h %s" --name-only   # map commits to themes
```

### 1.2 Work that produced no commit

Commits are not the whole record. Use the **chronicle** skill (`copilot_sessionStoreSql`)
to find investigative work, reviews, incidents and RCA that never became a commit:

```sql
SELECT id, repository, branch, substr(summary,1,180) AS summary, updated_at, agent_name
FROM sessions WHERE updated_at >= '<RANGE_START>' ORDER BY updated_at DESC
```

Drill into `turns` for the sessions that matter. Cross-repository sessions count when
the work was ours (for example a pull request review in another repository).

### 1.3 Merged is not deployed

Report both, and never conflate them:

```powershell
. ./scripts/scim-estates.ps1
foreach ($p in @('dev','canary-prod','customer-prod')) {
  $u = Get-ScimEstateBaseUrl -Purpose $p
  # token, then GET /scim/admin/version
}
```

**Resolve, never hardcode.** No FQDN, tenant id, subscription id or `AZURE_CONFIG_DIR`
belongs in this prompt. `Get-ScimEstateFqdn` sets and restores the per-tenant config
directory itself from the registry, so a tenant rollover needs no edit here. A name
carrying a generation suffix is a value with a shelf life.

If an estate probe fails, report it as unverified rather than carrying the previous
value forward. A retiring tenant can still serve traffic while ARM refuses to manage it,
so a failed probe means unknown, not down.

### 1.4 Tracking and CI

```powershell
gh pr list --state all --limit 30 --json number,title,state,isDraft,mergedAt,url,updatedAt
gh issue list --state all --limit 50 --json number,title,state,url,updatedAt
gh run list --limit 25 --json workflowName,status,conclusion,createdAt,headSha
```

Filter to the range. A failing check is a Risk, not a footnote.

### 1.5 Open items

Read [docs/auth/REMAINING_WORK_REGISTER.md](../../docs/auth/REMAINING_WORK_REGISTER.md)
for current status of open items. If the register contradicts what the code shows,
**say so** - a stale ledger row is itself a reportable finding.

Take test totals from `CHANGELOG.md` or the validated run, never from memory.

---

## Step 2 - Write the report

Six sections, in this order.

### 1) Standup bullets

Group by **theme**, not by commit. A reader wants "what changed for users", not a
shortlog. For each theme give the outcome and, where it exists, the measurement
("7 ms versus 2,866 ms" beats "improved performance").

Lead with the release list and the deployed-versus-merged line.

### 2) 30-second spoken script

Plain prose, roughly 90 to 110 words, readable aloud without stumbling. No bullet
characters, no markdown, no version strings denser than the ear can follow. Lead with
the headline outcome, name the single most valuable finding, close with the theme.

### 3) Done / In Progress / Risks / Next

- **Done**: shipped and validated in this range.
- **In Progress**: started, not finished, including anything awaiting approval.
- **Risks**: things that could bite. Include failing checks, estates behind, single
  points of recovery, scheduled-but-unapplied refactors, tests that never run, and
  any gate found to be non-functional.
- **Next**: ordered, each item actionable.

### 4) Consolidated work items (table)

Columns: `# | Work item | Status | Acceptance outcome`. Cover delivered **and** open
items so the list doubles as a backlog snapshot.

### 5) Consolidated work items (CSV, import ready)

Exact header, no deviation:

```
Title,Area,Status,Priority,Description,Acceptance Criteria
```

Rules that keep the file importable:

| Rule | Detail |
|---|---|
| Title | `SCIM Endpoint Service - <Group> - <Item>`. **No commas** in the title. |
| Area | Lowercase path, for example `auth/audit`, `ci/gates`, `operations/incident` |
| Status | `Done`, `In Progress`, `Next`, `Scheduled`, `Planned`, `Pending` |
| Priority | `1` blocking or customer-facing, `2` important, `3` housekeeping |
| Description | Always double-quoted. Semicolons to separate clauses, never bare commas outside quotes. |
| Acceptance Criteria | Always double-quoted. Testable outcomes, not restatements of the description. |

One row per work item, covering the same set as section 4.

### 6) Evidence

Commit count excluding bot commits, files changed, insertions and deletions, validated
test totals per layer, worktree cleanliness, and whether delivery went through a pull
request.

### Then: the copy-paste block

Repeat **all six sections** inside a single ` ```text ` fence so the whole update can be
copied in one click. Use the `====` banner separators. This block is the artifact the
operator actually pastes into the standup channel, so it must stand alone.

---

## Hard rules

1. **Verify, never recall.** Every number traces to a command run in this session.
2. **Merged is not deployed.** State both. An estate behind is a Risk.
3. **No pull request is not no work.** Direct-to-master delivery is normal here; say
   "no pull request" rather than omitting the item.
4. **Include the invisible work.** Reviews, incidents, RCA and environment triage
   belong in the report even with zero commits.
5. **Include every worktree**, plus dirty files and local-ahead commits.
6. **Never use an em-dash** anywhere in the output. Use a single hyphen.
7. **Report contradictions.** If a ledger, doc or register disagrees with the code,
   that gap is a finding.
8. **Measurements beat adjectives.** Prefer a number with its before and after.
9. If a check cannot run, say so and mark the item unverified. Do not guess.
