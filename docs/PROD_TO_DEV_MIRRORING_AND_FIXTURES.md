# Prod -> Dev mirroring + synthetic shape-coverage fixtures

> **Version:** 0.41.0  -  **Date:** May 6, 2026
> **Scope:** dev-tooling, no API surface change
> **Affects:** [api/src/scripts/mirror-prod-to-dev.ts](../api/src/scripts/mirror-prod-to-dev.ts), [api/src/scripts/seed-shape-coverage.ts](../api/src/scripts/seed-shape-coverage.ts), [scripts/mirror-prod-to-dev.ps1](../scripts/mirror-prod-to-dev.ps1)

---

## 1. Why

Reproducing prod-only bugs in dev required hand-crafting JSON or running long
SCIM sequences against a stock dev environment. To close that gap we now have a
two-stage tool that:

1. Copies every Endpoint, ScimResource, ResourceMember, EndpointCredential and
   the most recent slice of RequestLog from production into the dev database
   while preserving every primary key. The dev UI (and any URL bookmarks) keep
   working against IDs that match prod 1:1.
2. Layers ~6 small synthetic "shape" endpoints on top so dev simultaneously
   covers every interesting config / extension / custom-resource permutation
   without polluting prod.

The result: a dev database that is both a faithful prod replica AND a
combinatorial test fixture, in less than 36 SCIM resources of synthetic data.

## 2. Components

| File | Role |
|------|------|
| [api/src/scripts/mirror-prod-to-dev.ts](../api/src/scripts/mirror-prod-to-dev.ts) | Stage 1. Two `PrismaClient` instances, upsert-by-PK, orphan filtering, capped log copy. |
| [api/src/scripts/seed-shape-coverage.ts](../api/src/scripts/seed-shape-coverage.ts) | Stage 2. Builds 6 synthetic endpoints + 30 SCIM resources from deterministic UUIDs. |
| [scripts/mirror-prod-to-dev.ps1](../scripts/mirror-prod-to-dev.ps1) | Operator entry point. Resolves DB URLs from Container App secrets, optionally opens PG firewall, runs both stages, scrubs env on exit. |
| `npm run mirror:prod-to-dev` (api) | Convenience alias for stage 1 only (assumes env vars set). |
| `npm run seed:shape-coverage` (api) | Convenience alias for stage 2 only. |

## 3. How to run

### 3.1 Recommended (one shot, full pipeline)

```pwsh
.\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -RestartDevApp
```

The script will:

1. `az containerapp secret show ... --secret-name database-url` against
   `scimserver2` (prod) and `scimserver-dev` (dev) to resolve the connection
   strings.
2. Add a temporary PostgreSQL Flexible Server firewall rule for your current
   public IP on both servers (rule name `mirror-tmp-<8 hex>`).
3. Run stage 1 (`mirror-prod-to-dev.ts`) - copies prod data into dev.
4. Run stage 2 (`seed-shape-coverage.ts`) - layers synthetic shape endpoints.
5. Restart the active revision of the dev Container App so the in-memory
   endpoint cache rehydrates from PostgreSQL (see [§3.6](#36-why-restartdevapp-is-needed)).
6. Remove the firewall rules in a `finally` block, even on failure.
7. Wipe `PROD_DATABASE_URL` / `DEV_DATABASE_URL` from the parent shell.

### 3.2 Dry run (preview counts, no writes)

```pwsh
.\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -DryRun
```

### 3.3 Capture a transcript (relative paths auto-resolve)

```pwsh
.\scripts\mirror-prod-to-dev.ps1 -OpenFirewall -LogFile 'logs/mirror.log'
```

The `-LogFile` value is resolved against the repo root before the script
changes directory, so a relative path always lands where you expect (do not use
`Tee-Object` from the caller side - `Push-Location` happens inside the script).

### 3.4 Just refresh the synthetic shapes

```pwsh
.\scripts\mirror-prod-to-dev.ps1 -SkipMirror -OpenFirewall
```

### 3.5 BYO connection strings (no Azure auth needed)

```pwsh
$env:PROD_DATABASE_URL = "postgresql://user:pwd@prod-pg.postgres.database.azure.com:5432/scimdb?sslmode=require"
$env:DEV_DATABASE_URL  = "postgresql://user:pwd@dev-pg.postgres.database.azure.com:5432/scimdb?sslmode=require"
.\scripts\mirror-prod-to-dev.ps1
```

### 3.6 Why -RestartDevApp is needed

The `EndpointService` caches the entire `Endpoint` table in memory at
`onModuleInit()` and only updates the cache through its own write paths
(`createEndpoint`, `updateEndpoint`, `deleteEndpoint`). Direct database writes
from the mirror script are completely invisible to a running container until
its cache is rehydrated.

When you pass `-RestartDevApp`, the orchestrator runs:

```
az containerapp revision restart -n scimserver-dev -g scimserver-rg-dev --revision <active>
```

after both data stages succeed. On the next boot `onModuleInit()` re-reads the
`Endpoint`, `ScimResource`, `ResourceMember` and `EndpointCredential` tables
from PostgreSQL, and the dev API immediately reflects the mirrored state.

Without the flag, the script prints a NOTE telling you to restart manually.

## 4. Stage 1 - prod -> dev mirror

### 4.1 What it copies

| Table | Strategy | Notes |
|-------|----------|-------|
| `Endpoint` | upsert by `id` | Original `createdAt` preserved on insert. |
| `ScimResource` | upsert by `id` | Skipped if `endpointId` is missing in target after the endpoint sync. |
| `ResourceMember` | upsert by `id` | Skipped if either `groupResourceId` or `memberResourceId` is missing in target. |
| `EndpointCredential` | upsert by `id` | Skipped if `endpointId` is missing in target. |
| `RequestLog` | `createMany({ skipDuplicates: true })` in chunks of 500 from a 1000-row source page; last `LOG_DAYS` days only (default 7), capped at `LOG_LIMIT` rows (default 50000) | If `endpointId` is set but no longer exists, it is rebound to `null` (column is nullable per schema). A failing chunk falls back to per-row inserts so a single bad row never aborts the run. |

### 4.2 Decisions baked in

- **Two PrismaClient instances** rather than `pg_dump`: portable, lets us
  filter orphans cleanly, and avoids requiring `psql`/`pg_dump` on operator
  workstations.
- **PII copied verbatim.** Dev is internal-only and the mandate is exact prod
  replication for repro work.
- **Existing dev rows are not wiped.** Strategy is upsert-by-PK so the script
  is idempotent and any IDs already wired into the dev UI stay valid.
- **Orphans skipped** rather than copied or "fixed" - the sync surfaces, not
  hides, referential drift in prod.

### 4.3 Tunables (env vars)

| Var | Default | Effect |
|-----|---------|--------|
| `LOG_DAYS` | `7` | Window of `RequestLog.createdAt >= now - N days`. `0` disables. |
| `LOG_LIMIT` | `50000` | Hard cap on rows copied (newest first). |
| `DRY_RUN` | unset | When `1`, prints planned counts but writes nothing. |

## 5. Stage 2 - shape coverage seed

All synthetic endpoints are prefixed `shape-` so they are trivial to spot in
the UI and easy to drop with one SQL `DELETE` if needed.

### 5.1 Endpoint matrix

| Endpoint name | Preset | Settings flipped from default | Why this combo matters |
|---------------|--------|-------------------------------|-----------------------|
| `shape-rfc-strict` | `rfc-standard` | `StrictSchemaValidation=true`, `RequireIfMatch=true`, `PrimaryEnforcement=reject`, `AllowAndCoerceBooleanStrings=false` | Validates server behaves correctly under the strictest RFC interpretation. |
| `shape-entra-lenient` | `entra-id` | `StrictSchemaValidation=false`, `IgnoreReadOnlyAttributesInPatch=true`, `IncludeWarningAboutIgnoredReadOnlyAttribute=true`, `VerbosePatchSupported=false`, `PrimaryEnforcement=normalize` | Mirrors how Microsoft Entra ID actually talks to us (flat keys, readOnly in PATCH, boolean coercion). |
| `shape-custom-ext-user` | `user-only-with-custom-ext` | `MultiMemberPatchOpForGroupEnabled=false`, `VerbosePatchSupported=true` | Tests `writeOnly` and `returned:never` attributes inside an extension on a User-only schema. No Group resourceType. |
| `shape-soft-delete-only` | `entra-id-minimal` | `UserSoftDeleteEnabled=true`, `UserHardDeleteEnabled=false`, `GroupHardDeleteEnabled=false` | All deletes must be reversible. Verifies the hard-delete-disabled error path. |
| `shape-per-endpoint-creds` | `entra-id` | `PerEndpointCredentialsEnabled=true` | Plus one `EndpointCredential` row (bcrypt hash of `shape-dev-secret`, label `shape-dev-bearer`). Verifies the per-endpoint bearer guard path. |
| `shape-custom-resource` | inline custom profile | `StrictSchemaValidation=true`, `VerbosePatchSupported=true`, `MultiMemberPatchOpForGroupEnabled=true` | Adds a custom `Device` resource type at `urn:scimserver:devshapes:device:1.0` plus a custom HR extension on User at `urn:scimserver:devshapes:user:hr-extras:1.0`. End-to-end custom-resource test bed. |

### 5.2 Per-endpoint resources (3 users, 2 groups)

| Resource | Shape |
|----------|-------|
| User `u1.minimal@shape.dev` | Just `userName`, `active=true`. Simplest happy path. |
| User `u2.rich@shape.dev` | `name`, two `emails` (1 primary + 1 secondary), one `phoneNumber`, `externalId`, on extension endpoints also includes extension attribute values. |
| User `u3.edge@shape.dev` | `active=false`, `externalId` only, no `name`/`emails`/`phoneNumber`. Tests deactivated path and minimal-data PATCH targets. |
| Group `Shape Group g1.multi` | Members: `u1`, `u2`. Multi-member PATCH testbed. |
| Group `Shape Group g2.solo` | Member: `u3` (deactivated). Single-member, deactivated-member edge case. |

`shape-custom-ext-user` is the only endpoint without groups (the preset
intentionally omits the Group resourceType).

### 5.3 Idempotency model

- Endpoints upserted by **`name`**.
- Users upserted by **(endpointId, userName)**.
- Groups upserted by **(endpointId, displayName)** with member rows replaced
  in a single transaction-style delete + re-insert.
- Endpoint credentials upserted by **(endpointId, label)**.

Re-running stage 2 produces zero duplicates and updates the rows in place.

### 5.4 Per-endpoint bearer credential

```pwsh
# Hit the per-endpoint creds shape using its dev bearer:
curl -H "Authorization: Bearer shape-dev-secret" `
     "https://<dev-fqdn>/scim/endpoints/shape-per-endpoint-creds/Users"
```

The plaintext secret `shape-dev-secret` is intentionally well-known and
documented here. It exists ONLY in the dev database and is rejected by any
endpoint other than `shape-per-endpoint-creds`.

## 6. Cleanup

Drop ALL synthetic shapes (keeps prod-mirrored data intact):

```sql
-- run against the dev PostgreSQL
DELETE FROM "Endpoint" WHERE name LIKE 'shape-%';
-- ScimResource, ResourceMember, EndpointCredential cascade via FK
```

Drop ONLY the prod mirror (keeps shapes intact) is intentionally not provided -
to undo a mirror, the safest path is to recreate the dev PG database via
[scripts/deploy-dev.ps1](../scripts/deploy-dev.ps1).

## 7. Operational guardrails

- The orchestrator only ever **reads** from prod (no writes ever).
- Firewall rules are tagged `mirror-tmp-<rand>` and removed in `finally`.
- Connection strings are scrubbed from the parent shell on exit.
- `RequestLog` copy is capped to avoid pulling multi-GB of log data; raise
  `-LogDays`/`-LogLimit` only when required.
- Resource IDs use deterministic UUID v5-style derivation from a label so
  re-runs are idempotent and predictable.

## 8. Related docs

- [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) - dev/prod resource group topology
- [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) - app names, FQDNs, secret names
- [MULTI_ENDPOINT_GUIDE.md](MULTI_ENDPOINT_GUIDE.md) - endpoint isolation model that this script preserves
- [ENDPOINT_CONFIG_FLAGS_REFERENCE.md](ENDPOINT_CONFIG_FLAGS_REFERENCE.md) - flag catalog used by the shape matrix
- [G11_PER_ENDPOINT_CREDENTIALS.md](G11_PER_ENDPOINT_CREDENTIALS.md) - the bearer-credential model that `shape-per-endpoint-creds` exercises
