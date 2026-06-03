---
name: prismaMigrationAudit
description: Verify Prisma schema, migration history, and runtime model are consistent. Catches the classic "schema edited but migration not generated" CD blocker before it hits deploy.
argument-hint: Optional - "check" (read-only audit) or "generate" (also create missing migration). Defaults to "check".
---

The API has THREE sources of truth that must stay in lockstep:

1. **`api/prisma/schema.prisma`** - the declared data model.
2. **`api/prisma/migrations/*/migration.sql`** - the historical migration files committed to git.
3. **The runtime database** (Postgres in dev/prod/Docker; nothing for inmemory backend).

A common bug class:
- Developer edits `schema.prisma` (adds a column).
- Developer runs the build and tests locally - all pass because Prisma client regenerates from `schema.prisma`.
- Developer commits without running `prisma migrate dev --name <X>`.
- CI runs `prisma migrate deploy` against a fresh dev DB - missing migration -> 500 errors at runtime.

This prompt is the standing audit that catches the gap BEFORE the commit.

---

## Step 1 - Verify schema.prisma is buildable

```powershell
cd api
npx prisma format
# Expected: file reformatted in place (no errors). If errors, the schema is broken.

npx prisma validate
# Expected: "The schema is valid." If validation fails, fix before proceeding.

npx prisma generate
# Expected: regenerates the Prisma client in node_modules/.prisma/client.
# If this fails, the client and schema are out of sync.
```

---

## Step 2 - Verify schema drift against migration history

```powershell
cd api
npx prisma migrate status
# Expected output one of:
#   "Database schema is up to date!"      <- all migrations applied, schema matches
#   "X migration(s) have not yet been applied"  <- missing prisma migrate deploy step
#   "Drift detected"                       <- schema.prisma diverges from migration history; THIS IS THE BUG
```

If status reports "Drift detected" OR "Following migrations have not been recorded":
- `schema.prisma` has been edited but no migration file was generated to record the change.
- Action: create the migration.

```powershell
# Only when explicitly requested or argument is "generate":
npx prisma migrate dev --name <descriptive_name>
# Generates a new migration file under api/prisma/migrations/<timestamp>_<name>/
# and applies it to the local dev DB. Commit BOTH the migration file AND
# the updated schema.prisma in the same git commit.
```

---

## Step 3 - Verify migration files are committed

```powershell
cd api
$migDir = "prisma/migrations"
$onDisk = (Get-ChildItem $migDir -Directory -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Name) | Sort-Object
$tracked = (git ls-files prisma/migrations | ForEach-Object { ($_ -split '/')[2] } | Where-Object { $_ }) | Sort-Object -Unique
$untracked = Compare-Object $onDisk $tracked -PassThru | Where-Object { $_.SideIndicator -eq '<=' }
if ($untracked) { Write-Host "UNCOMMITTED MIGRATIONS:"; $untracked }
```

Any migration directory on disk but NOT in git is an uncommitted migration that will not deploy. Action: `git add api/prisma/migrations/<name>` and commit.

---

## Step 4 - Verify model count is documented

The README + `docs/PROJECT_HEALTH_AND_STATS.md` advertise the model count (e.g. "5 models" in [docs/PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md)). When you add or remove a model:

```powershell
$models = (Get-Content api/prisma/schema.prisma) | Select-String '^model\s+(\w+)\s+{' | ForEach-Object { ($_.Line -replace '^model\s+(\w+).*', '$1') }
"Current models ($($models.Count)):"
$models | ForEach-Object { "  - $_" }
```

Update the documented count in:
- [docs/PROJECT_HEALTH_AND_STATS.md](../../docs/PROJECT_HEALTH_AND_STATS.md)
- [README.md](../../README.md) tech-stack table if mentioned
- Any architecture ER diagram in `docs/`

---

## Step 5 - Verify InMemory repository implementations match the new model

When a model is added or modified, the corresponding `InMemoryXxxRepository` in `api/src/infrastructure/repositories/inmemory/` must be updated.

```powershell
cd api/src/infrastructure/repositories/inmemory
Get-ChildItem -File -Filter '*.ts' | ForEach-Object { $_.Name }
# Match this list against the Prisma model list from Step 4.
# A new model with NO inmemory repository = inmemory tests will crash at runtime.
```

This is also one of the inputs to `crossBackendParityAudit`.

---

## Step 6 - Verify Docker compose entrypoint runs migrations

```powershell
Get-Content api/docker-entrypoint.sh | Select-String 'prisma migrate deploy'
# Expected: at least one line invoking `npx prisma migrate deploy`.
```

If missing, the Docker container will boot against an empty DB. Without `migrate deploy`, the first SCIM request will 500. Add the migration step BEFORE the node process starts.

---

## Step 7 - Verify the dev / prod state JSON files don't pin to an old migration

```powershell
Get-Content scripts/state/deploy-state-*.json | ConvertFrom-Json | Select-Object -Property name, updatedAtUtc
# Just confirm the file timestamps are recent. The state files don't pin
# migrations directly, but a stale state often correlates with a stale image.
```

---

## Outputs

When this prompt completes, produce:
1. `prisma migrate status` summary (Step 2).
2. List of uncommitted migration directories (Step 3).
3. Current model count vs documented count (Step 4).
4. List of InMemory repositories present vs Prisma models (Step 5).
5. Confirmation that `docker-entrypoint.sh` runs migrations (Step 6).
6. Recommended actions for any gap found.

---

## When to run this prompt

- Immediately after editing `api/prisma/schema.prisma`.
- Before any commit that touches `api/prisma/`.
- Before deploying to dev (verify migration files are committed before they're needed at deploy time).
- After a merge / rebase that conflicts in `prisma/migrations/`.
