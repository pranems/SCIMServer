# Deployment Infrastructure and Form Factors

> **Status:** Living reference - **Created:** 2026-07-29 - **Last verified:** 2026-08-25 - **Repo version at capture:** `api/package.json` = `0.55.14`
> **Scope:** Every infrastructure element SCIMServer runs on, every deployment form factor, and the measured state of all three live Azure estates.
> **Maintenance:** This document is **enforced**, not aspirational - see [Section 0.1](#01-maintenance-contract---this-is-a-living-document). Gate: `pwsh scripts/audit-deployment-doc.ps1`.
> **Companion docs:** [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) (canonical for cost + load scenarios), [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md) (how-to walkthrough), [DOCKER_GUIDE_AND_TEST_REPORT.md](DOCKER_GUIDE_AND_TEST_REPORT.md) (Docker build detail), [SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md](SOVEREIGN_AND_GOV_CLOUD_DEPLOYMENT.md) (sovereign clouds). This doc is the canonical source for **which infra elements exist, why, and their measured configuration**.

---

## 0. Provenance and how to reproduce every fact

Nothing in this document is inferred from memory. Every Azure value was read from the live control plane or the live data plane on the capture date; every repo value was read from the file cited.

| Fact class | Source | Capture command |
|---|---|---|
| Azure resource inventory | ARM control plane, subscription `ProvIAM_Subscription` (`8cb58fd6-cf6f-4334-9fe0-3b12f93a6596`), tenant `9751e42f-78f3-42f4-8b8a-6e73845aceae` (Provisioning IAM Team 09) | `az resource list --query "[].{rg:resourceGroup,name:name,type:type,location:location,sku:sku.name}" -o table` |
| Container App config | ARM | `az containerapp show -n <app> -g <rg> -o json` |
| Revisions and traffic | ARM | `az containerapp revision list -n <app> -g <rg> --query "[].[name,properties.active,properties.replicas,properties.runningState,properties.trafficWeight]" -o tsv` |
| Managed environment | ARM | `az containerapp env show -n scimserver-env -g scimserver-prod -o json` |
| PostgreSQL | ARM | `az postgres flexible-server list -o json`, `... parameter show --name max_connections`, `... firewall-rule list` |
| Networking | ARM | `az network vnet list -o json` |
| Registry | ARM + data plane | `az acr show -n acrscimsrv09`, `az acr repository show-tags -n acrscimsrv09 --repository scimserver --orderby time_desc --top 10` |
| Running app state (all 3 estates, incl. the cross-tenant one) | Data plane `GET /scim/admin/version` after OAuth `client_credentials` | see [Section 12](#12-verification-recipes) |
| Node.js support status | [endoflife.date/nodejs](https://endoflife.date/nodejs) (last updated 2026-07-14) and [nodejs.org previous releases](https://nodejs.org/en/about/previous-releases) | web fetch |
| Azure Container Apps rate card | [Azure Container Apps pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/) | web fetch |

**Cross-tenant caveat.** The customer-facing production estate (calmsand) lives in a **different Azure AD tenant** (`9de357c6-4488-4a8d-bd2f-14696f1af950`, subscription `AnandSa-Test-150`) than dev and the canary prod. The `az` session used for this capture was authenticated to the ProvIAM tenant only, so calmsand's ARM-level facts (SKUs, revisions, firewall rules) are **not enumerable here**. Everything stated about calmsand below came from its **data plane** (`/scim/admin/version`, which self-reports resource group, container app, registry, database host, and runtime) or from the repo's own promotion tooling. Rows that could not be verified are marked `not enumerable (cross-tenant)`.

---

### 0.1 Maintenance contract - this is a living document

A reference doc that is not mechanically tied to the thing it describes rots silently. Worse, a **confidently wrong** infra doc is more dangerous than no doc at all, because it terminates an investigation in the wrong place - which is precisely how the 2026-05-17 security intake "resolved" the Node base-image drift by checking `api/Dockerfile` (which does not ship) instead of the root `Dockerfile` (which does), leaving an EOL runtime in production for two more months.

So this document is **enforced by a gate**, not by good intentions.

#### The rule

> **Any change to the infrastructure updates this document in the same commit.**

"Infrastructure" is defined mechanically - it is exactly the set [scripts/audit-deployment-doc.ps1](../scripts/audit-deployment-doc.ps1) watches:

| Path | Why it is infra |
|---|---|
| `Dockerfile*` | image composition and base image |
| `docker-compose*.yml` | the Docker form factor |
| `infra/**` (Bicep) | declared Azure topology |
| `.github/workflows/**` | the supply chain that builds and publishes the artifact |
| `api/docker-entrypoint.sh` | container boot sequence |
| `dev-containerapp.yaml`, `prod-app-template.json` | Container App templates |
| `scripts/{deploy-azure,promote-to-prod,dev-deployment-pipeline,verify-deployment,build-standalone,audit-base-images}.ps1` | provisioning, promotion, verification, packaging |

#### The gate

```powershell
pwsh scripts/audit-deployment-doc.ps1          # static  - Stage 1.11
pwsh scripts/audit-deployment-doc.ps1 -Live    # + probes every live estate
```

It also runs automatically on **every push** (Fast tier of [scripts/pre-push-checks.ps1](../scripts/pre-push-checks.ps1), alongside `infra: base images on LTS`), so this is not a gate someone has to remember to invoke. At pre-push the working tree is clean and the change lives in commits, so the hook passes the upstream ref as `-BaseRef` - comparing against `HEAD` alone would make C1 structurally incapable of ever firing.

| Check | Fails when |
|---|---|
| **C1** change coverage | an infra path above changed and this doc did not change in the same diff |
| **C2** freshness | the `**Last verified:**` header date is older than 90 days |
| **C3** element coverage | a `Dockerfile*`, `docker-compose*.yml` or `infra/*.bicep` exists on disk that this doc never names |
| **C4** live truth (`-Live`) | a reachable estate runs a Node major that is not Active/Maintenance LTS, or reports a version this doc does not mention |

C3 is what makes the gate **self-extending**: add a new Bicep template or Dockerfile and the gate starts demanding documentation for it on the next run, with no edit to the gate itself. C4 is the deployed-artifact half of the Node-LTS rule - [audit-base-images.ps1](../scripts/audit-base-images.ps1) gates the **source**, C4 gates **what is actually running**, and both read the same LTS table from [scripts/node-lts.ps1](../scripts/node-lts.ps1) so they cannot disagree.

**The gate has its own self-test.** [scripts/test-audit-deployment-doc.ps1](../scripts/test-audit-deployment-doc.ps1) feeds the auditor deliberately bad input and asserts each check fires: an infra change with no doc update (C1), a backdated `Last verified` (C2), and an undocumented `infra/*.bicep` (C3). Run it after touching the auditor. This exists because this repo has twice shipped a gate that reported PASS on input it was written to reject - `audit-base-images.ps1` v1 indexed characters instead of lines, and C1 v1 compared the working tree against `HEAD`, which is always empty at pre-push. Neither was caught by writing the gate carefully; both were caught by watching them fail. The harness refuses to run on a dirty tree, because it mutates and reverts tracked files.

```mermaid
flowchart LR
    A["infra change<br/>(Dockerfile, Bicep,<br/>workflow, deploy script)"] --> B{"C1: doc updated<br/>in same commit?"}
    B -->|"no"| F["FAIL - update the doc"]
    B -->|"yes"| C{"C3: every infra<br/>element documented?"}
    C -->|"no"| F
    C -->|"yes"| D{"C2: Last verified<br/>within 90 days?"}
    D -->|"no"| G["FAIL - re-run Section 12<br/>capture recipes"]
    D -->|"yes"| E{"C4 -Live: estates on<br/>supported Node LTS?"}
    E -->|"no"| H["FAIL - promote the<br/>LTS image"]
    E -->|"yes"| P["PASS"]
    F --> R["Section 15 change log<br/>+ bump Last verified"]
    G --> R
    H --> R
    R --> P
```

#### What to update, per change type

| Change | Sections to revisit |
|---|---|
| Base image / Dockerfile stage | [7 Image supply chain](#7-image-supply-chain), [2 Form factors](#2-the-six-form-factors) |
| New or removed Azure resource | [3 Element catalogue](#3-azure-infrastructure-element-catalogue), [4 Live estates](#4-live-estates---measured-configuration), [11 Cost model](#11-cost-model) |
| Container env var added | [Container environment variables](#container-environment-variables-set-by-the-template), [9 Configuration surface](#9-configuration-surface-by-form-factor) |
| Deploy / promote script behaviour | [8 Deployment flows](#8-deployment-flows) |
| A deployment to any estate | [4 Live estates](#4-live-estates---measured-configuration) measured table |
| Anything that reveals a gap | [10 Drift and gap register](#10-drift-and-gap-register), [14 Self-improvement](#14-self-improvement-and-designarchitecture-gate-disposition) |
| **Every** change | [15 Change log](#15-change-log) + the `**Last verified:**` header date |

#### Standing rules for facts

1. **Measured, never remembered.** Every value here is reproducible via a command in [Section 12](#12-verification-recipes). If a fact cannot be captured, mark it `not enumerable` with the reason (see the cross-tenant caveat) rather than guessing.
2. **Verify against the artifact that ships.** CI builds the **root** `Dockerfile` (`publish-ghcr.yml` -> `file: ./Dockerfile`). A same-named sibling is not evidence.
3. **A gap is recorded, not silently fixed later.** New findings go in [Section 10](#10-drift-and-gap-register) with severity, evidence, impact and remedy, and get a disposition in [Section 14](#14-self-improvement-and-designarchitecture-gate-disposition) - applied, scheduled, or accepted with a reason.
4. **Promote findings that recur.** A gap seen twice, or one high-severity escape, graduates from this register to a hard gate in [.github/copilot-instructions.md](../.github/copilot-instructions.md), following the standing `issue -> pattern -> rule` loop.

---

## 1. Executive summary

SCIMServer ships as **one container image** that runs in **six form factors**. Only one of them (Azure Container Apps) involves Azure infrastructure; the rest exist so the identical binary can be exercised locally, in CI, and air-gapped.

```mermaid
flowchart LR
    SRC["Source: api/ (NestJS) + web/ (React + Vite)"]

    subgraph BUILD["Build"]
      DF["Root Dockerfile - 4 stages, node:24-alpine"]
      SA["scripts/build-standalone.ps1"]
      TSC["tsc + vite (no container)"]
    end

    SRC --> DF
    SRC --> SA
    SRC --> TSC

    subgraph FF["Deployment form factors"]
      F1["F1 Local Node process"]
      F2["F2 Docker Compose (api + postgres)"]
      F3["F3 Single container"]
      F4["F4 Standalone Windows package"]
      F5["F5 Azure Container Apps"]
      F6["F6 CI ephemeral (GitHub Actions)"]
    end

    TSC --> F1
    DF --> F2
    DF --> F3
    SA --> F4
    DF --> F5
    DF --> F6

    F1 --> MEM["Backend: inmemory (default for F1/F4)"]
    F2 --> PG["Backend: prisma over PostgreSQL 17"]
    F3 --> PG
    F4 --> MEM
    F4 --> PG
    F5 --> PGAZ["Backend: prisma over Azure DB for PostgreSQL Flexible Server"]
    F6 --> MEM
```

**Key structural facts**

1. The image is **built once** from the repo-root [Dockerfile](../Dockerfile). `Dockerfile.optimized`, `Dockerfile.ultra`, [api/Dockerfile](../api/Dockerfile), and `api/Dockerfile.multi` are referenced by **no** workflow, compose file, or deploy script - they are dead artifacts, and two of them still assume a SQLite persistence model the product left behind in Phase 3.
2. Persistence is selected at runtime by a single env var read in one place: `PERSISTENCE_BACKEND` in [api/src/infrastructure/repositories/repository.module.ts](../api/src/infrastructure/repositories/repository.module.ts). Default is `prisma`; the only other value is `inmemory`.
3. Azure provisioning is **100 % Bicep**. [scripts/deploy-azure.ps1](../scripts/deploy-azure.ps1) contains no `az containerapp create/update` - it only calls `az deployment group create` against four templates in [infra/](../infra).
4. All three public install paths ([bootstrap.ps1](../bootstrap.ps1) -> [setup.ps1](../setup.ps1), and [deploy.ps1](../deploy.ps1)) converge on `deploy-azure.ps1 -ProvisionPostgres`, so a first-time user always lands on the same Azure shape.
5. Six Azure resource types constitute the entire cloud footprint. There is no App Service, no AKS, no Key Vault, no Front Door, no Storage account, and no private endpoint in the live estates.

---

## 2. The six form factors

| # | Form factor | Artifact | Persistence | Ports | Web UI served | Migrations run | Primary use |
|---|---|---|---|---|---|---|---|
| F1 | Local Node process | `api/dist/main.js` after `npm run build` | `inmemory` (default) or `prisma` | `PORT` env, code default **3000**, live-test convention **6000** | yes, from `api/public` | no (manual `prisma migrate dev`) | Stage 4.3 inmemory parity live tests |
| F2 | Docker Compose | root `Dockerfile` + `postgres:17` | `prisma` | `8080` api, `5432` postgres | yes | yes, in entrypoint | Stage 4.2 gate, local prod-equivalent |
| F3 | Single container | same image, `docker run` | `prisma` (needs external `DATABASE_URL`) | `8080` | yes | yes | third-party self-host |
| F4 | Standalone Windows package | `standalone/` directory tree | `inmemory` default, `prisma` opt-in, optional bundled PostgreSQL | `8080` | yes, from `public/` | opt-in (`-RunMigrations`) | air-gapped / no-Docker demos |
| F5 | Azure Container Apps | same image via GHCR or ACR | `prisma` over Flexible Server | ingress 443 -> container `8080` | yes | yes | dev + 2 production estates |
| F6 | CI ephemeral | GitHub-hosted `ubuntu-latest` runner | `inmemory` | n/a | n/a | n/a (migration **linter** runs instead) | pre-push validation |

### F1 - Local Node process

Built with `cd api; npm run build`, launched with `node api/dist/main.js`. [api/src/main.ts](../api/src/main.ts) reads `Number(process.env.PORT ?? 3000)`; the container images and Bicep both override this to `8080`, and the repo's live-test convention uses `6000` for the inmemory local node. In non-production (`NODE_ENV !== 'production'`) [api/src/modules/auth/shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) generates an ephemeral 32-byte base64url `SCIM_SHARED_SECRET` and writes it back into `process.env` so a bare local run is usable; in production a missing shared secret is fatal to the request.

### F2 - Docker Compose

[docker-compose.yml](../docker-compose.yml) defines exactly two services.

```mermaid
flowchart TB
    subgraph HOST["Docker host"]
      subgraph NET["compose default bridge network"]
        API["service: api<br/>container scimserver-api<br/>image built from root Dockerfile<br/>PERSISTENCE_BACKEND=prisma"]
        DB["service: postgres<br/>container scimserver-postgres<br/>image postgres:17<br/>healthcheck pg_isready"]
      end
      VOL[("named volume pgdata")]
      LOGS[("bind mount ./logs -> /app/logs")]
      INIT["scripts/init-pg-extensions.sql<br/>mounted read-only into<br/>/docker-entrypoint-initdb.d/01-extensions.sql"]
    end
    CLIENT["Host :8080"] --> API
    API -->|"postgresql://scim:scim@postgres:5432/scimdb"| DB
    DB --- VOL
    DB --- INIT
    API --- LOGS
    API -.->|"depends_on: service_healthy"| DB
```

`docker-compose.debug.yml` is a different animal: it builds **no** image, runs `image: node:24` with `./api` bind-mounted, exposes `3000` (SCIM) plus `9229` (inspector), and sets `NODE_OPTIONS=--inspect=0.0.0.0:9229`. Note it points `DATABASE_URL` at host `postgres` but declares no such service, so it only works alongside a separately started database.

`docker-compose.ci-image.yml` is an **override**, never used alone:

```bash
docker compose -f docker-compose.yml -f docker-compose.ci-image.yml up -d --no-build
```

It swaps the `api` service's `build:` for `image: ${SCIM_CI_IMAGE:-ghcr.io/pranems/scimserver:latest}` with `pull_policy: missing`. **The tag is an environment variable, not a hardcoded pin (changed 2026-07-31).** It used to be pinned to `0.54.0-alpha.12`, which had long since gone stale - a hardcoded tag in a file nobody re-reads silently exercises the *wrong* artifact, which is worse than not testing the form factor at all. Set `$env:SCIM_CI_IMAGE` to the image under test.

It exists because **`npm ci` inside `docker build` cannot reach a registry on a Microsoft corp-managed host**: the container does not inherit the host `~/.npmrc`, so npm resolves against public `registry.npmjs.org`, which is **egress-blocked by design** as a corporate secure-supply-chain control. npm surfaces this unhelpfully as `Exit handler never called!` after ~73s. **Note the correction (2026-07-30):** an earlier version of this paragraph said "the npm registry is TLS-blocked on some developer hosts", which framed a deliberate control as a broken machine - npm works fine on the host through the corporate feed proxy, and only the container path is blocked. See [strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md). Confirm in five seconds with `docker run --rm node:24-alpine npm ping` (container, fails) versus `npm config get registry` (host, shows the corporate proxy). Without this override the **Docker form factor cannot be exercised at all** on such a host, so a real gate would silently be skipped; with it, the CI-built image is pulled and the form factor is tested for real. It also sets `JWKS_HOST_ALLOWLIST`, which [docker-compose.yml](../docker-compose.yml) omits and whose absence fails 5 WIF-verify live assertions for an environment reason rather than a code one.

Two consequences worth knowing:

- Compose **merges** list values, so an override that adds a `ports:` entry APPENDS rather than replaces. Free the host port instead (`docker stop scim-dev-pipeline-pg`) or use `!override`.
- The compose secrets differ from local and dev: `-ClientSecret devscimclientsecret -SharedSecret devscimsharedsecret`.

### F4 - Standalone Windows package

[scripts/build-standalone.ps1](../scripts/build-standalone.ps1) produces a **directory**, not a single binary, and it is Windows-only (`.bat` and `.ps1` launchers, `node-vX-win-<arch>.zip`, EDB Windows PostgreSQL binaries). Contents: compiled `dist/`, production `node_modules` with the Prisma CLI and engines grafted in (needed for `migrate deploy`), `prisma/`, `src/generated/`, `public/` (the built web UI), launchers, and a generated README.

| Launcher | Backend | Notable defaults |
|---|---|---|
| `start.bat` | `inmemory` | `PORT=8080`, `JWT_SECRET=changeme-jwt`, `SCIM_SHARED_SECRET=changeme`, `OAUTH_CLIENT_SECRET=changeme-oauth` |
| `start.ps1` | `-Backend inmemory` or `prisma`; passing `-DatabaseUrl` forces `prisma` | `-RunMigrations` invokes `node node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma` |
| `start-postgres.bat` | `prisma` | `DATABASE_URL=postgresql://scim:scim@localhost:5432/scimdb`, always migrates first |
| `start-bundled-postgres.bat` (only with `-IncludePostgres`) | `prisma` | `initdb -U scim -E UTF8 --no-locale -A trust`, `pg_ctl start -p 5432`, `createdb scimdb`, migrate, start |

Optional switches: `-IncludeNode` downloads `https://nodejs.org/dist/v<ver>/node-v<ver>-win-<x64|x86>.zip` and extracts only `node.exe`; `-IncludePostgres` downloads the EDB Windows binaries; `-Zip` packs the tree with `System.IO.Compression.ZipFile` (chosen over `Compress-Archive` because of long paths inside `node_modules`). The checked-in `standalone/` tree was built at **v0.52.2** with `-IncludeNode` (bundled Node v24.13.0) and **without** `-IncludePostgres`.

### F6 - CI ephemeral

Seven workflows build, validate or audit; none of them deploy. The first three build an image; the next three never touch the artifact and exist only to make an upstream change visible; the last one exists because a corp-managed device physically cannot produce one of the build inputs.

| Workflow | Trigger | What it produces / gates |
|---|---|---|
| [build-test.yml](../.github/workflows/build-test.yml) | push to `test/** dev/** feature/** feat/** ci/** fix/** release/**`, PR to `master`, dispatch | Verifies **lockfile provenance** (public `resolved` hosts + sha512 `integrity` only) before installing anything, then the full validate job, then pushes `ghcr.io/pranems/scimserver:test-<branch>` + `:sha-<sha>`, runs a **container smoke test** (boots the image on the inmemory backend, requires `/scim/health` `status=ok`, requires `ServiceProviderConfig` to carry its SCIM schema URN, and asserts npm/npx are absent), then **Trivy** (`HIGH,CRITICAL`, `exit-code: 1`, `ignore-unfixed: true`, `trivyignores: .trivyignore`) |
| [build-and-push.yml](../.github/workflows/build-and-push.yml) | push tag `v*`, dispatch | Semver + `latest` + `sha-` tags to GHCR, Trivy gate |
| [publish-ghcr.yml](../.github/workflows/publish-ghcr.yml) | dispatch only, inputs `version` (required) and `pushLatest` | `:<version>` and `:sha-<sha>`; `latest` created via `docker buildx imagetools create`. **This is the workflow the dev pipeline drives.** |
| [codeql.yml](../.github/workflows/codeql.yml) | push `master`/`feat/**`, PR to `master`, Mondays 04:00 UTC, dispatch | CodeQL `security-extended,security-and-quality` for `javascript-typescript` |
| [trivyignore-review.yml](../.github/workflows/trivyignore-review.yml) | **Daily** 04:00 UTC, dispatch, push touching `.trivyignore` | Opens/updates/closes a `[security] .trivyignore review needed` issue. Explicitly non-blocking. **Daily, not weekly**, since 2026-08-04: entries now carry a `Class`, and a `quarantine-window` entry is a hold of at most 7 days - a weekly cron cannot police a seven-day deadline |
| [dependency-pins-review.yml](../.github/workflows/dependency-pins-review.yml) | Mondays 03:30 UTC, dispatch, push to `master` touching `api/package.json` | Queries the GitHub Advisory Database for every package pinned in `api/package.json` `overrides` and opens/updates/closes a `[security] pinned dependency review needed` issue. Non-blocking (needs network). Exists because an override **freezes** a version and **Dependabot does not manage the `overrides` block**, so a pin added to FIX one advisory silently becomes the VULNERABLE version of the next. Strictly broader than the Trivy gate, which is HIGH+CRITICAL only |
| [rfc-currency.yml](../.github/workflows/rfc-currency.yml) | 06:00 UTC on the 1st monthly, dispatch, PR touching `docs/rfcs/**`, `docs/auth/rfcs/**`, `scripts/sync-rfcs.ps1`, `scripts/rfc-index.ps1` or itself | Runs [sync-rfcs.ps1](../scripts/sync-rfcs.ps1) offline (C1-C5) then `-Online` (O1-O3) against `www.rfc-editor.org`. Blocking, `timeout-minutes: 20`, `permissions: contents: read` |
| [regen-lockfile.yml](../.github/workflows/regen-lockfile.yml) | dispatch (input `workspace`: `api`/`web`/`both`), push to `chore/regen-lockfile*` | Runs `npm install --package-lock-only` against the **public** registry and uploads `regenerated-lockfiles`. Hard-fails if any `resolved` host is not `registry.npmjs.org` (C1) or any `integrity` is not sha512 (C2), and prints the publish age of every changed package. `permissions: contents: read` - it **cannot** write to the repo |

**Why the last two are scheduled rather than commit-triggered.** Both watch for a change that happens **upstream while this repository sits still**, so no commit can trigger them: a new RFC starting to update one we depend on (RFC 7643 was updated by RFC 9865 and RFC 9967), a verified erratum changing what the text means without changing a mirrored byte, or a CVE-exception entry going stale. A commit-triggered gate is structurally incapable of finding any of them. The pre-push gate `docs: RFC corpus current + intact` runs only the **offline** half so pre-push stays deterministic and works without network; the online half runs on the clock here. A failure of this job is a reading assignment, not a build break - the workflow's own failure step spells out the read-assess-update-then-`-Update` sequence and explicitly forbids running `-Update` to silence it.

**Why a workflow exists just to run `npm install`.** Microsoft corp-managed devices redirect npm to a corporate feed proxy. Package *resolution* works there, but *lockfile generation* does not produce a committable file: the proxy serves only a legacy `shasum` and no `integrity`, so every entry npm rewrites comes back with an internal `resolved` host and a **sha1** integrity while the other ~725 entries are sha512. Committing that would publish an internal endpoint from a public repo and weaken the lockfile's own tamper-evidence, and it cannot be patched by hand because the correct sha512 is not obtainable on the device. Measured in [NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md) Section 5. This workflow is therefore the **only** supported way to change a lockfile from a managed device, and is what Stage 6.1 of the instructions means by "regenerate in CI". It deliberately holds `contents: read` and returns an artifact rather than pushing, so a lockfile change stays a reviewed human act. Nothing about it bypasses the corporate 7-day quarantine: the runner is not a managed device, but the job prints each changed package's age and flags anything under 7 days, so a pin that a colleague could not install is visible in review.

All three build workflows use `context: .` and `file: ./Dockerfile`, and every `uses:` line is SHA-pinned with a trailing `# vX.Y.Z` comment. The validate job runs `npx prisma generate` **before** lint (type-aware ESLint rules need real Prisma types), runs the migration linter `src/scripts/lint-migrations.ts`, and runs E2E with `PERSISTENCE_BACKEND=inmemory` and `--maxWorkers=2` (the 2-core runner over-subscribes at the default 4 and produces `ECONNRESET` in parallel-HTTP specs).

---

## 3. Azure infrastructure element catalogue

Exactly **six** ARM resource types are provisioned. Everything else visible in the subscription belongs to unrelated projects.

| # | ARM type | API version in Bicep | Declared in | Purpose | Why this and not something else |
|---|---|---|---|---|---|
| A1 | `Microsoft.App/containerApps` | `2024-03-01` | [infra/containerapp.bicep](../infra/containerapp.bicep) | The running SCIM server | Serverless containers with built-in revisions + traffic splitting give blue/green for free; no orchestrator to operate |
| A2 | `Microsoft.App/managedEnvironments` | `2024-03-01` | [infra/containerapp-env.bicep](../infra/containerapp-env.bicep) | Compute + networking + logging boundary shared by apps | Required parent of A1; also the unit of VNet integration and the `defaultDomain` |
| A3 | `Microsoft.OperationalInsights/workspaces` | `2022-10-01` | [infra/containerapp-env.bicep](../infra/containerapp-env.bicep) | Container console/system log sink, 30-day retention | The only log destination ACA supports natively besides Azure Monitor |
| A4 | `Microsoft.Network/virtualNetworks` (+ 3 subnets) | `2023-09-01` | [infra/networking.bicep](../infra/networking.bicep) | Deterministic address space for the ACA environment | Custom VNet is required for stable egress and future private endpoints |
| A5 | `Microsoft.DBforPostgreSQL/flexibleServers` (+ database + firewall rule) | `2024-08-01` | [infra/postgres.bicep](../infra/postgres.bicep) | System of record for all SCIM data | Prisma targets PostgreSQL; Flexible Server is the managed single-node option |
| A6 | `Microsoft.ContainerRegistry/registries` | `2023-07-01` | [infra/acr.bicep](../infra/acr.bicep) | Private image store | **Declared but never deployed by any script.** The live ACR was created out-of-band; see [Section 10](#10-drift-and-gap-register) |

Two additional resources exist in the estate but are **platform-managed**, not authored by us: `capp-svc-lb` and `capp-svc-lb-ip` (both `Standard` SKU) in the auto-created infrastructure resource group `ME_scimserver-env_scimserver-prod_eastus`. Azure Container Apps creates these to front the environment's ingress.

### A1 - Container App, as declared

```mermaid
flowchart TB
    subgraph CA["Microsoft.App/containerApps@2024-03-01"]
      direction TB
      CFG["configuration<br/>activeRevisionsMode: Multiple"]
      ING["ingress<br/>external: true<br/>targetPort: 8080<br/>transport: auto"]
      REG["registries<br/>username+password OR system identity OR anonymous"]
      SEC["secrets<br/>scim-shared-secret, jwt-secret,<br/>oauth-client-secret, database-url<br/>(+ ghcr-password when creds supplied)"]
      TPL["template.containers[0] name=scimserver<br/>cpu 0.5 vCPU, memory 1Gi<br/>minReplicas 1, maxReplicas 1"]
      PRB["probes on /scim/health<br/>Startup 10s + 5s x 30 = ~160s budget<br/>Liveness 30s/5s/3<br/>Readiness 10s/3s/3"]
      ID["identity: SystemAssigned"]
    end
    CFG --> ING
    CFG --> REG
    CFG --> SEC
    CA --> TPL --> PRB
    CA --> ID
```

The ~160 s startup budget is deliberate: the entrypoint runs `node node_modules/prisma/build/index.js migrate deploy` before `node dist/main.js`, and a cold Burstable database plus a multi-migration catch-up can take well over a minute.

Registry-auth selection logic in the template, in order:
1. Both `ghcrUsername` and `ghcrPassword` supplied -> username + `passwordSecretRef: 'ghcr-password'` against `acrLoginServer`.
2. Otherwise, `acrLoginServer != 'ghcr.io'` -> `identity: 'system'` (managed-identity pull).
3. Otherwise -> **no** `registries` block at all, i.e. anonymous GHCR pull.

### Container environment variables set by the template

| Variable | Source | Value |
|---|---|---|
| `SCIM_SHARED_SECRET`, `JWT_SECRET`, `OAUTH_CLIENT_SECRET`, `DATABASE_URL` | `secretRef` | Container App secrets |
| `PERSISTENCE_BACKEND` | literal | `prisma` |
| `NODE_ENV` | literal | `production` |
| `PORT` | literal | `8080` |
| `CORS_ORIGIN` | param, default `''` | empty means allow-all, see below |
| `SCIM_RG`, `SCIM_APP`, `SCIM_REGISTRY`, `SCIM_CURRENT_IMAGE` | ARM functions | metadata surfaced by the in-app "Copy Update Command" |
| `LOG_LEVEL` | literal | `DEBUG` |
| `LOG_FORMAT` | literal | `json` |
| `LOG_FILE` | literal | `''` (disables file logging on ephemeral container disk) |
| `LOG_RING_BUFFER_SIZE` | literal | `5000` |
| `LOG_RETENTION_DAYS` | literal | `30` |
| `LOG_SLOW_REQUEST_MS` | literal | `1000` |

---

## 4. Live estates - measured configuration

**Where the estates are declared: [scripts/scim-estates.json](../scripts/scim-estates.json).** Since 2026-08-13 that registry is the machine-readable source of truth for tenants and estates, and scripts address them by **role** (`active` / `next` / `retiring` / `permanent` / `trial`) rather than by hardcoded name. This section remains the human-readable measured record; the registry is what the tooling reads.

**The registry deliberately stores no FQDN.** Azure assigns the Container Apps environment domain at creation time - `purplecliff-91e4026d` today, `proudbush-ae90986e` before it, and the now-**retired** `yellowsmoke-af7a3fff` before that - so it is unknowable until the environment exists and different on every rebuild. A stored FQDN is a value guaranteed to become false. `Get-ScimEstateFqdn` in [scripts/scim-estates.ps1](../scripts/scim-estates.ps1) derives it from ARM instead, which is why the Stage 1.11 **C4** live check now follows a tenant rollover automatically rather than needing to be edited.

```powershell
. ./scripts/scim-estates.ps1
Show-ScimEstates                       # every tenant and estate, names AND ids, no Azure calls
Get-ScimEstate     -Purpose dev        # the ACTIVE dev estate
Get-ScimEstateBaseUrl -Purpose dev     # https://<fqdn>, derived from ARM
```

Four estates are live. Dev and the canary prod moved to a **new Azure AD tenant on 2026-08-12** (see [Section 15](#15-change-log)); the two estates in the previous tenant were deliberately **left running and intact** rather than deleted, so they remain live and are listed here.

Names, regions, and resource groups differ in ways that matter operationally, so they are listed exactly as measured.

| Attribute | **Dev** | **Canary prod** (purplecliff) | **Customer prod** (calmsand) |
|---|---|---|---|
| Container App | `scimserver-dev` | `scimserver` | `scimserver-prod` |
| Resource group | `scimserver-dev` | `scimserver-prod` | `scimserver-rg-prod` |
| Subscription | `ProvIAM_Subscription` (`8cb58fd6-...`) | `ProvIAM_Subscription` (`8cb58fd6-...`) | `AnandSa-Test-150` (`e299a87a-...`) |
| Tenant | `9751e42f-...` (Provisioning IAM Team 09) | `9751e42f-...` (Provisioning IAM Team 09) | `9de357c6-...` (AnandSa-Test-150) |
| Region | East US | East US | Central US |
| Managed environment | `scimserver-env` (**in RG `scimserver-prod`** - cross-RG) | `scimserver-env` | not enumerable (cross-tenant) |
| FQDN | `scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io` | `scimserver.purplecliff-91e4026d.eastus.azurecontainerapps.io` | `scimserver-prod.calmsand-7f4fc5dc.centralus.azurecontainerapps.io` |
| Revision mode | **Multiple** (`scimserver-dev--v0556` at 100 %, 2 active) | **Multiple** (`scimserver--v0556` at 100 %, 2 active) | Multiple |
| Revisions retained (`revisionKeep`) | **2** - serving + rollback target | **2** - serving + rollback target | **1** (2026-08-14, cost) - **no rollback target; recovery is roll-forward** |
| Image reference | `ghcr.io/pranems/scimserver@sha256:435c6dc2...f1d2` (**digest-pinned**) | `ghcr.io/pranems/scimserver@sha256:435c6dc2...f1d2` (**digest-pinned**) | `ghcr.io` per self-report |
| Managed identity | SystemAssigned | SystemAssigned | not enumerable |
| Registry auth | **anonymous GHCR pull** (no `registries[]` entry) | **anonymous GHCR pull** (no `registries[]` entry) | anonymous GHCR pull |
| Ingress | external, port 8080, transport Auto, `allowInsecure: false` | external, port 8080, transport Auto, `allowInsecure: false` | not enumerable |
| App secrets | `database-url`, `jwt-secret`, `oauth-client-secret`, `scim-shared-secret` | same four | not enumerable |
| CPU / memory | 0.5 vCPU / 1 GiB | 0.5 vCPU / 1 GiB | not enumerable |
| Replicas | min 1 / max 1 | min 1 / max 1 | not enumerable |
| Workload profile | Consumption | Consumption | not enumerable |
| PostgreSQL host | `scimserver-pg-dev-09.postgres.database.azure.com` (**East US 2**) | `scimserver-pg-09.postgres.database.azure.com` (**East US 2**) | `scimserver-prod-pg.postgres.database.azure.com` |
| PostgreSQL SKU | `Standard_B1ms` Burstable, 32 GB, 7-day backup, geo-redundant off | `Standard_B1ms` Burstable, 32 GB, 7-day backup, geo-redundant off | not enumerable |
| Database | `scimdb`, PostgreSQL 17 | `scimdb`, PostgreSQL 17 | `scimdb`, PostgreSQL 17 |
| Running app version | **0.55.13** | **0.55.13** | **0.55.13** |
| Node.js runtime in container | **v24.19.0** (Active LTS) | **v24.19.0** (Active LTS) | **v24.18.1** (Active LTS) |

**The retiring tenant-08 estates are still live.** The 2026-08-12 migration copied everything to tenant 09 and changed nothing in tenant 08, by explicit instruction. Both old estates keep serving on `proudbush-ae90986e.eastus.azurecontainerapps.io` (`scimserver-dev` and `scimserver`, subscription `5738ea6a-...`, tenant `f08e6aff-...`). Their **ARM control plane expired on 2026-08-11**, so they can no longer be managed, scaled, redeployed or deleted - but the running containers and their PostgreSQL data plane are unaffected and still reachable. They are **not** deployment targets: every pipeline, gate and script now points at `purplecliff-91e4026d`. Treat them as read-only historical estates that will disappear on their own when the subscription is reclaimed.

| Process uptime at capture | 1,135 s | n/a | 746,807 s (~8.6 days) |

```mermaid
flowchart TB
    INET(["Internet / Entra ID provisioning service"])

    subgraph T1["Tenant 9751e42f (ProvIAM Team 09) - subscription ProvIAM_Subscription 8cb58fd6"]
      subgraph RGP["RG scimserver-prod (East US)"]
        ENVP["managedEnvironment scimserver-env<br/>defaultDomain purplecliff-91e4026d.eastus...<br/>staticIp 20.237.113.238<br/>Consumption, zoneRedundant false"]
        APPP["containerApp scimserver<br/>Multiple revisions, GHCR tag 0.55.1"]
        VNETP["vnet scimserver-vnet 10.40.0.0/16"]
        LAW["logAnalytics scimserver-logs<br/>PerGB2018, 30 days"]
        ACR["ACR acrscimsrv09<br/>Basic, adminUser DISABLED, unused"]
        PGP["PG flexibleServer scimserver-pg-09<br/>East US 2, B1ms, PG17"]
      end
      subgraph RGD["RG scimserver-dev"]
        APPD["containerApp scimserver-dev<br/>Multiple revisions, GHCR tag 0.55.5"]
        PGD["PG flexibleServer scimserver-pg-dev-09<br/>East US 2, B1ms, PG17"]
        VNETD["vnet scimserver-dev-vnet (East US)<br/>UNUSED - see Gap G2"]
      end
    end

    subgraph T2["Tenant 9de357c6 - subscription AnandSa-Test-150"]
      subgraph RGC["RG scimserver-rg-prod (Central US)"]
        APPC["containerApp scimserver-prod<br/>anonymous GHCR pull"]
        PGC["PG scimserver-prod-pg"]
      end
    end

    GHCR["ghcr.io/pranems/scimserver"]

    INET --> APPP
    INET --> APPD
    INET --> APPC
    ENVP --> APPP
    ENVP --> APPD
    ENVP --- VNETP
    ENVP --- LAW
    APPP --> PGP
    APPD --> PGD
    APPC --> PGC
    GHCR --> APPP
    GHCR --> APPC
    ACR --> APPD
    GHCR -->|"az acr import"| ACR
```

Two structural facts stand out in that graph and are easy to miss:

- **The dev app does not have its own environment.** `scimserver-dev` lives in resource group `scimserver-dev` but its `environmentId` points at `scimserver-env` in resource group `scimserver-prod`. Dev and canary prod therefore share one managed environment, one Log Analytics workspace, one VNet, and one static egress IP.

  **This sharing is now expressible in the tooling, not just an accident of history.** A subscription is capped on Container Apps environments (`MaxNumberOfGlobalEnvironmentsInSub`), so sharing is a hard requirement rather than a convenience. [infra/containerapp.bicep](../infra/containerapp.bicep) takes an optional `environmentResourceId` and [scripts/deploy-azure.ps1](../scripts/deploy-azure.ps1) an optional `-EnvironmentResourceId`; when set, the template skips resolving `environmentName` inside the app's own resource group and binds `environmentId` to the supplied full resource ID. **A bare environment NAME cannot express a cross-resource-group reference** - `az containerapp env show -n <name> -g <this-rg>` looks only in that resource group and fails with a not-found error, which is precisely the failure this parameter removes. When the parameter is supplied the script also skips environment creation entirely, reads the environment back with `az containerapp env show --ids`, and aborts if it cannot be read - so a typo fails loudly instead of silently provisioning a second environment against the subscription cap.
- **`scimserver-dev-vnet` (East US 2) is orphaned.** It has the same address space and the same three delegated subnets as the prod VNet, but no environment references it.

---

## 5. Network topology

Both VNets carry the identical address plan from [infra/networking.bicep](../infra/networking.bicep).

```mermaid
flowchart LR
    subgraph VNET["vnet 10.40.0.0/16"]
      S1["aca-infra<br/>10.40.0.0/21<br/>delegated Microsoft.App/environments"]
      S2["aca-runtime<br/>10.40.8.0/21<br/>delegated Microsoft.App/environments"]
      S3["private-endpoints<br/>10.40.16.0/24<br/>no delegation"]
    end
    ENV["managedEnvironment<br/>vnetConfiguration.infrastructureSubnetId -> aca-infra<br/>internal: false"]
    S1 --> ENV
    ENV -->|"egress via environment static IP"| PG["PostgreSQL Flexible Server<br/>publicNetworkAccess: Enabled"]
    S3 -.->|"reserved, no private endpoint deployed today"| PG
```

Measured facts:

- All three subnets set `privateEndpointNetworkPolicies: Disabled` and `privateLinkServiceNetworkPolicies: Disabled`.
- The environment binds **only** `aca-infra`. `aca-runtime` is delegated and reserved but currently unreferenced.
- `internal: false` and `zoneRedundant: false`. The environment's static IP is `20.237.113.238`.
- The database path is **public-network**, not private endpoint. Reachability is granted by the firewall rule `AllowAllAzureServices` (`0.0.0.0` to `0.0.0.0`, which is the Azure-specific "allow Azure services" sentinel, not a literal 0.0.0.0/0 internet allow).
- Both PostgreSQL servers are in **East US 2** while both Container Apps are in **East US**. Every query therefore crosses a region boundary.

Live firewall rules:

| Server | Rule | Range |
|---|---|---|
| `scimserver-pg-09` (canary prod) | `AllowAllAzureServices` | `0.0.0.0` - `0.0.0.0` |
| `scimserver-pg-dev-09` (dev) | `AllowAllAzureServices` | `0.0.0.0` - `0.0.0.0` |

The tenant-09 servers carry **only** the Azure-services sentinel rule. The previous estate had accumulated `AllowMyIP-temp` rules pinning individual developer IP addresses - rules whose name announced they were temporary and which then outlived the machine that needed them. They were not recreated. If a rule like that is added for a debugging session, delete it in the same session.

---

## 6. Data plane - PostgreSQL Flexible Server

| Property | Dev `scimserver-pg-dev-09` | Canary prod `scimserver-pg-09` | Declared default in Bicep |
|---|---|---|---|
| Region | East US 2 | East US 2 | `resourceGroup().location` |
| Tier / SKU | Burstable / `Standard_B1ms` | Burstable / `Standard_B1ms` | `Burstable` / `Standard_B1ms` |
| PostgreSQL version | 17 | 17 | `17` (allowed 14-17) |
| IOPS | 120 | 120 | n/a (tier-derived) |
| Storage auto-grow | Disabled | Disabled | n/a |
| Backup retention | 7 days | 7 days | `7` |
| Geo-redundant backup | Disabled | Disabled | `Disabled` |
| High availability | Disabled | Disabled | `Disabled` |
| Public network access | Enabled | Enabled | `Enabled` |
| Entra ID (AAD) auth | Disabled | Disabled | `Disabled` |
| Password auth | Enabled | Enabled | `Enabled` |
| Admin login | `scimadmin` | `scimadmin` | `scimadmin` |
| Database | `scimdb` (UTF8, `en_US.utf8`) | `scimdb` | `scimdb` |
| `max_connections` | 50 | **50** | n/a (tier default) |
| `azure.extensions` | `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP` | `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP` | set by deploy script to `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP` (**all four since 2026-08-11**, see G9) |
| Storage declared | n/a | n/a | `storageSizeMB = 32768` -> 32 GB |

`azure.extensions` is a **static** server parameter, so [scripts/deploy-azure.ps1](../scripts/deploy-azure.ps1) sets it and then issues `az postgres flexible-server restart`. The extensions are not optional: the baseline migration `api/prisma/migrations/20260223000000_postgresql_baseline/migration.sql` depends on them, and a missing extension surfaces as a Prisma **P3009** failure that crash-loops the container through the startup probe.

The connection string shape emitted by the Bicep output is:

```text
postgresql://<adminLogin>:<adminPassword>@<serverFqdn>:5432/<databaseName>?sslmode=require
```

The application's Prisma connection pool is capped at **5** connections per process (self-reported by `/scim/admin/version` as `storage.connectionPool.maxConnections`). That number interacts badly with revision accumulation - see finding **G1**.

---

## 7. Image supply chain

```mermaid
flowchart LR
    GIT["git commit on feat/* or master"]
    subgraph GHA["GitHub Actions (ubuntu-latest)"]
      VAL["validate job<br/>lint + migration lint + unit + E2E(inmemory) + web build"]
      BLD["docker/build-push-action<br/>context . file ./Dockerfile<br/>platforms linux/amd64"]
      TRV["Trivy scan<br/>HIGH,CRITICAL - exit-code 1"]
    end
    GHCR[("ghcr.io/pranems/scimserver<br/>tags: version, sha-, latest, test-branch")]
    ACR[("acrscimsrv09.azurecr.io/scimserver<br/>Basic SKU - provisioned but UNUSED")]
    DEV["Container App scimserver-dev"]
    CAN["Container App scimserver (canary prod)"]
    CUS["Container App scimserver-prod (calmsand)"]

    GIT --> VAL --> BLD --> GHCR
    BLD --> TRV
    GHCR -.->|"az acr import - optional mirror, not on the serving path"| ACR
    GHCR -->|"anonymous pull"| DEV
    GHCR -->|"digest-pinned by promote-to-prod.ps1"| CAN
    GHCR -->|"anonymous pull, digest-pinned"| CUS
```

**Why GHCR is the source of truth.** The calmsand tenant cannot pull from the ProvIAM-tenant ACR (cross-tenant ACR pull would require cross-tenant credentials), so calmsand pulls anonymously from GHCR. Consequently the CI-built GHCR artifact is the single deployable, and ACR is a **mirror** populated by `az acr import`, not an independent build. The dev pipeline enforces this ordering explicitly: stage 4.3 dispatches `publish-ghcr.yml`, 4.4 proves anonymous pull works (`docker logout ghcr.io` then `docker pull`), 4.5 imports into ACR, and 4.5b refuses to continue if the tag is not visible in ACR.

**Digest pinning.** [scripts/promote-to-prod.ps1](../scripts/promote-to-prod.ps1) resolves `docker buildx imagetools inspect ghcr.io/pranems/scimserver:<tag>`, parses `^Digest:\s+(sha256:[0-9a-f]+)`, and deploys `ghcr.io/pranems/scimserver@<digest>`. It refuses to promote if the digest cannot be parsed. Both tenant-09 estates are digest-pinned to `sha256:435c6dc2...f1d2` (v0.55.6) as of 2026-08-12.

**Registry inventory at capture.** ACR `acrscimsrv09` (RG `scimserver-prod`) exists with SKU `Basic`, `adminUserEnabled: **false**`, `publicNetworkAccess: Enabled`, and holds the `scimserver` repository with tags `0.55.1`, `0.55.3`, `0.55.5`. **It is not on the serving path.** Both tenant-09 apps pull anonymously from GHCR and carry **no `registries[]` entry at all**, which is the same pattern customer prod has always used.

This was a deliberate simplification made during the 2026-08-12 tenant migration. Wiring ACR back up requires an `AcrPull` role assignment for each app's managed identity, and the deployment service principal is scoped as **Contributor**, which does not include `Microsoft.Authorization/roleAssignments/write`. Rather than widen the deployment principal to Owner or User Access Administrator - a permanent privilege increase to solve a one-time setup problem - the estate uses the public registry that the customer-facing estate already depends on. That also removes the ACR admin-user credential that gap **G6** used to describe, and the misleading `registries[]` mapping that gap **G7** used to describe. The cost is a dependency on GHCR availability and public-image exposure, both of which were already true for calmsand.

### Image composition

The root [Dockerfile](../Dockerfile) is four stages on `node:24-alpine`:

| Stage | Purpose | Notable |
|---|---|---|
| `web-build` | `npm ci` + `npm run build` in `web/` | deletes `node_modules` after build |
| `api-build` | `npm ci`, `npx prisma generate`, `npx tsc -p tsconfig.build.json` | sets a placeholder `DATABASE_URL` because `prisma.config.ts` calls `env('DATABASE_URL')` at config-load time even for `generate`, which never connects |
| `prod-deps` | `npm ci --omit=dev`, then **grafts** `prisma`, `@prisma/engines`, `@prisma/engines-version` from `api-build` | grafting avoids reinstalling ~100 MB of transitive dev deps just to get `prisma migrate deploy`; then strips cockroachdb/mysql/sqlite/sqlserver Prisma runtimes, `typescript`, `@types`, and the Studio UI |
| `runtime` | final image | `apk upgrade --no-cache libcrypto3 libssl3` (patches ahead of the base image cadence, e.g. CVE-2026-45447 in `PKCS7_verify`), **npm/npx/yarn deleted** (see below), non-root user `scim` uid 1001 / group `nodejs` gid 1001, `NODE_OPTIONS=--max_old_space_size=384`, `ARG IMAGE_TAG` written to `/app/.image-tag`, `HEALTHCHECK` that parses `http://127.0.0.1:8080/scim/health` and requires `status === 'ok'`, `EXPOSE 8080`, `CMD ["/app/docker-entrypoint.sh"]` |

#### Why npm is deleted from the runtime image

npm is a **build-time** tool. The running container starts with `node dist/main.js` and needs no package manager. Keeping it was not free: npm's OWN bundled dependencies under `/usr/local/lib/node_modules/npm` accounted for **5 of the 7** HIGH/CRITICAL findings blocking the Trivy gate, including the only CRITICAL.

| Package (npm-bundled) | Version | Findings |
|---|---|---|
| `tar` | 7.5.15 | CVE-2026-59873 (**CRITICAL**, gzip-bomb DoS), CVE-2026-59874 (HIGH) |
| `brace-expansion` | 5.0.6 | CVE-2026-13149, CVE-2026-14257 (HIGH) |
| `undici` | 6.26.0 | CVE-2026-12151 (HIGH) |

None of these are our dependencies, so **no `package.json` or lockfile change could ever fix them** - which is precisely why the Dependabot PRs opened against this gate also failed. The distinguishing evidence is the image path Trivy reports: `usr/local/lib/node_modules/npm/...` is the base image's npm, whereas `app/node_modules/...` is ours.

The single former npm usage was `npx prisma migrate deploy` in [api/docker-entrypoint.sh](../api/docker-entrypoint.sh). That is now a direct invocation, `node node_modules/prisma/build/index.js migrate deploy`, which is **exactly equivalent rather than a workaround**: prisma's `bin` field is `{"prisma": "build/index.js"}`, so `npx prisma` resolved to that same file, and the CLI is grafted into the image by the `prod-deps` stage. The standalone Windows launcher already used this form.

### Container boot sequence

```mermaid
stateDiagram-v2
    [*] --> Entrypoint
    Entrypoint --> CheckBackend: "docker-entrypoint.sh, set -e"
    CheckBackend --> SkipMigrate: "PERSISTENCE_BACKEND is inmemory"
    CheckBackend --> Migrate: "otherwise"
    Migrate --> MigrateFailed: "prisma migrate deploy non-zero"
    Migrate --> StartApp: "migrations applied"
    SkipMigrate --> StartApp
    MigrateFailed --> [*]: "exit 1, ACA restarts the replica"
    StartApp --> Listening: "exec node dist/main.js"
    Listening --> Ready: "startup probe GET /scim/health returns 200"
    Ready --> Serving: "readiness probe passes, ingress routes traffic"
    Serving --> Serving: "liveness probe every 30s"
```

---

## 8. Deployment flows

### 8.1 Greenfield provisioning - `deploy-azure.ps1`

```mermaid
flowchart TB
    P0["Pre-flight<br/>Start-Transcript to scripts/logs/<br/>secret cache scripts/state/deploy-state-RG-APP.json<br/>az account show<br/>register Microsoft.App + Microsoft.ContainerService"]
    P1["Step 1/5 Resource Group<br/>az group show, else az group create"]
    P2["Step 2/5 Network<br/>vnet exists: ensure 3 subnets individually<br/>vnet missing: deploy infra/networking.bicep"]
    P3["Step 3/5 PostgreSQL (only with -ProvisionPostgres)<br/>deploy infra/postgres.bicep<br/>set azure.extensions then restart server"]
    P4["Step 4/5 Managed Environment<br/>-EnvironmentResourceId set: skip creation,<br/>read it back with az containerapp env show --ids<br/>else skip if it already exists<br/>else deploy infra/containerapp-env.bicep --no-wait<br/>poll up to 900s then up to 600s"]
    P5["Step 5/5 Container App<br/>skip if current image already equals desired<br/>else deploy infra/containerapp.bicep with a temp params file<br/>pass environmentResourceId when cross-resource-group<br/>poll up to 300s"]
    P6["Verify<br/>GET /scim/admin/version with Bearer SCIM secret<br/>18 attempts x 10s"]
    P7["Print URL, SCIM base path, secrets, log commands, cost estimate"]

    P0 --> P1 --> P2 --> P3 --> P4 --> P5 --> P6 --> P7
```

Every step is idempotent by existence check, and every resource is created through `az deployment group create`. The script never calls `az containerapp create` or `az containerapp update` directly.

The public entry points all funnel here:

| Path | Behavior |
|---|---|
| [bootstrap.ps1](../bootstrap.ps1) | Cache-busting loader. Fetches `setup.ps1` from `raw.githubusercontent.com/pranems/SCIMServer/<branch-or-sha>` with `Pragma: no-cache` and `Invoke-Expression`s it. Deploys nothing itself |
| [setup.ps1](../setup.ps1) | Prompts (or reads `SCIMSERVER_*` env vars, `SCIMSERVER_UNATTENDED=1` to suppress prompts), stages `scripts/deploy-azure.ps1` plus all four Bicep files into `%TEMP%`, then runs `deploy-azure.ps1 ... -ProvisionPostgres`. Auto-generates a 48-char base64url SCIM secret and 64-char JWT/OAuth secrets when unset |
| [deploy.ps1](../deploy.ps1) | Standalone colleague-facing path. Uses `./scripts/deploy-azure.ps1` when present, else downloads the branch zip. Validates the Container App name against the Azure 2-32 char / lowercase / no-`--` rules in a retry loop |
| [scripts/deploy-dev.ps1](../scripts/deploy-dev.ps1) | Thin wrapper that always sets `ProvisionPostgres=$true` and defaults `-DevResourceGroup` to `<ProdResourceGroup>-dev`, creating a fully isolated dev stack |

### 8.2 Blue/green promotion - `promote-to-prod.ps1 -BlueGreen`

```mermaid
sequenceDiagram
    autonumber
    participant OP as "Operator / pipeline"
    participant PS as "promote-to-prod.ps1"
    participant GH as "GHCR"
    participant ACA as "Azure Container Apps"
    participant GRN as "green label FQDN"
    participant PUB as "public FQDN"

    OP->>PS: "-ProdResourceGroup -ProdAppName -ImageTag -BlueGreen -RunVerification"
    PS->>PUB: "GET /scim/health on dev, then read current prod image"
    PS->>GH: "docker buildx imagetools inspect TAG"
    GH-->>PS: "Digest sha256 ..."
    Note over PS: "Refuses to continue if the digest cannot be parsed"
    PS->>ACA: "resolve blue = highest-weight ACTIVE revision (4 attempts, 5s apart)"
    PS->>ACA: "assert blue is active, else exit 1"
    PS->>ACA: "revision set-mode --mode multiple"
    PS->>ACA: "ingress traffic set blue=100"
    PS->>ACA: "update --image DIGEST --revision-suffix green-MMdd-HHmm"
    PS->>ACA: "ingress traffic set blue=100 green=0"
    PS->>ACA: "revision label add --label green"
    PS->>GRN: "GET /scim/health x18 every 10s"
    PS->>GRN: "OAuth token, then GET /scim/admin/version until runtime.hostname matches the green suffix (x30)"
    PS->>GRN: "assert reported version equals the semver ImageTag"
    PS->>GRN: "verify-deployment.ps1 on the green URL"
    PS->>ACA: "ingress traffic set green=100 blue=0"
    PS->>PUB: "verify-deployment.ps1 post-flip"
    Note over PS,ACA: "Any failure triggers rollback#58; traffic blue=100 green=0 then revision deactivate green"
```

Three assertions in that flow exist because of specific past incidents, and they are worth keeping in mind when reading the code:

- **Blue must be a live revision.** A 2026-06-24 promotion pinned 100 % of traffic to a deactivated revision and produced a 404 on the canary prod. The script now asserts `properties.active == true` on the resolved blue and exits 1 otherwise.
- **The green URL must actually route to the new revision.** A stale `green` label can point at a previous green. The script demands that `runtime.hostname` from `/scim/admin/version` contains the freshly generated suffix.
- **The served version must equal the tag.** GHCR builds from the remote ref while a local ACR build builds from the working tree, so a tag `0.53.4` once served v0.53.3. The version equality assertion closes that gap.

Without `-BlueGreen` the script falls back to a legacy auto-flip: update the image with a new revision suffix, then poll the public FQDN 12 times at 10 s. No 0 % soak, no verification, no automatic rollback.

### 8.3 The full dev pipeline - `dev-deployment-pipeline.ps1`

| Stage | Gate |
|---|---|
| 0 | Prereqs (`git npm node docker az gh`, Docker daemon, `az account show`), tag confirmation, dev **before-state** snapshot to `test-results/dev-before-<sha>.json` |
| 1 | 1.1 api build, 1.2 api lint (errors only), 1.3 `web` `tsc --noEmit` with a ratchet of 9 prod / 96 total, 1.5 web build, 1.6 size-limit |
| 2 | Starts an ephemeral `postgres:17` container if nothing is on 5432; 2.1 api unit, 2.2 api E2E (prisma), 2.3 web vitest, 2.4 web coverage (78/70/65/75), 2.6 `test-all-modes.ps1` |
| 3 | Eleven audit prompts recorded as `PENDING` (advisory, not executed by the script) |
| 4 | 4.1 full-validation pipeline, 4.2 optional ACR mirror, 4.3 dispatch `publish-ghcr.yml` pinned to the current branch, 4.4 anonymous-pull proof, 4.5 `az acr import`, 4.5b tag-visible check, 4.6 `az containerapp update`, 4.6b version-echo poll, 4.7 `live-test.ps1` **gated on 4.6b** |
| 5 | 5.3 Playwright against the dev FQDN with `E2E_TOKEN=changeme-scim` |
| 6 | Post-deploy state diff vs the before-snapshot; fails on endpoint count delta or any missing ID |
| 6.5 | Auto-canary to the `purplecliff` canary prod, blocked by any FAIL, any SKIPPED, the freeze file `scripts/.deploy-freeze`, or `SCIMSERVER_AUTOCANARY_DISABLE` |
| 7 | Writes `test-results/dev-deploy-<timestamp>.md` including the exact cross-tenant calmsand promote commands |

`--ref` pinning on the workflow dispatch (stage 4.3) exists because an unpinned dispatch once published from `master` instead of the working branch.

### 8.4 Verification - `verify-deployment.ps1`

Runs, in order: health probe; a **data and ID inventory snapshot** (`/scim/admin/endpoints?count=200` then per-endpoint `Users?count=1` and `Groups?count=1` for `totalResults`) written to `test-results/inventory-<label>.json`; an optional before/after diff that fails on endpoint-count delta, any missing ID, or any per-endpoint count **regression**; the live SCIM suite via `live-test.ps1`; and optionally Playwright with `--grep-invert 'Visual regression|Visual Snapshots'` (pixel baselines are data-coupled and would falsely abort a healthy flip).

---

## 9. Configuration surface by form factor

| Variable | Consumed in | Default in code | F1 local | F2 compose | F4 standalone | F5 Azure |
|---|---|---|---|---|---|---|
| `PERSISTENCE_BACKEND` | [repository.module.ts](../api/src/infrastructure/repositories/repository.module.ts) | `prisma` | `inmemory` | `prisma` | `inmemory` | `prisma` |
| `DATABASE_URL` | [prisma.service.ts](../api/src/modules/prisma/prisma.service.ts) | falls back to `postgresql://scim:scim@localhost:5432/scimdb` with a warning | unset | compose value | optional | Container App secret |
| `PORT` | [main.ts](../api/src/main.ts) | `3000` | `6000` by convention | `8080` | `8080` | `8080` |
| `API_PREFIX` | [main.ts](../api/src/main.ts) | `scim` | same | same | same | same |
| `CORS_ORIGIN` | [cors-origin.ts](../api/src/security/cors-origin.ts) | empty / `*` -> allow-all; `false`/`none` -> disabled; CSV -> allowlist | unset | unset | unset | `''` (allow-all) |
| `SCIM_SHARED_SECRET` | [shared-secret.guard.ts](../api/src/modules/auth/shared-secret.guard.ts) | none; fatal in production, ephemeral auto-generated otherwise | auto | `devscimsharedsecret` | `changeme` | secret |
| `OAUTH_CLIENT_ID` | [oauth.service.ts](../api/src/oauth/oauth.service.ts) | `scimserver-client` | same | same | same | same |
| `OAUTH_CLIENT_SECRET` | [oauth.service.ts](../api/src/oauth/oauth.service.ts) | none | - | `devscimclientsecret` | `changeme-oauth` | secret |
| `JWT_SECRET` | only reported as a boolean by the admin controller | none | - | `devjwtsecretkey123456` | `changeme-jwt` | secret |
| `CREDENTIAL_KEK` | [credential-kek.ts](../api/src/security/credential-kek.ts) | `changeme-credential-kek` | default | `changeme-credential-kek` | default | **not set by Bicep** |
| `LOG_LEVEL` | [log-levels.ts](../api/src/modules/logging/log-levels.ts) | `INFO` | - | - | - | `DEBUG` |
| `LOG_FORMAT` | [log-levels.ts](../api/src/modules/logging/log-levels.ts) | forced `json` when production, else `pretty` | pretty | json | json | `json` |
| `LOG_FILE` | [file-log-transport.ts](../api/src/modules/logging/file-log-transport.ts) | `logs/scimserver.log`; empty disables | default | default | default | `''` |
| `LOG_RING_BUFFER_SIZE` | [scim-logger.service.ts](../api/src/modules/logging/scim-logger.service.ts) | service constant | - | - | - | `5000` |
| `LOG_RETENTION_DAYS` | [logging.service.ts](../api/src/modules/logging/logging.service.ts) `|| 21`; admin controller `|| 30` | see note | - | - | - | `30` |
| `LOG_SLOW_REQUEST_MS` | [log-levels.ts](../api/src/modules/logging/log-levels.ts) | `2000` | - | - | - | `1000` |

Two nuances worth knowing before debugging a deployment:

- **`JWT_SECRET` is plumbed everywhere but signs nothing.** [api/src/oauth/oauth.module.ts](../api/src/oauth/oauth.module.ts) builds its JWT options from `OAuthSigningKeyService` using an **asymmetric** key pair (`privateKeyPem`/`publicKeyPem`, `algorithm: keys.alg`, `keyid: keys.kid`) and pins `verifyOptions.algorithms = [keys.alg]` as the algorithm-confusion defense. `JWT_SECRET` survives only as a `jwtSecretConfigured` boolean on `/scim/admin/version`.
- **`LOG_RETENTION_DAYS` has two different fallbacks** for the same variable (21 for the auto-prune path, 30 for the admin default). The Bicep sets it explicitly to 30, so Azure is unambiguous, but a local or standalone run is not.

### 9.1 Secret durability - what survives losing the workstation

Asked and measured on 2026-08-13. The useful question is not "what secrets are on this machine" but **"what could not be recovered if the machine were destroyed tonight"**. Almost everything can be.

| Tier | Material | Where it lives | If the workstation is lost |
|---|---|---|---|
| **3** | `database-url`, `jwt-secret`, `oauth-client-secret`, `scim-shared-secret` for the live estates | Azure Container Apps secrets | **Safe.** Read them back with `az containerapp secret list -n <app> -g <rg>`. Azure is the backup; a local copy only widens exposure. |
| **2** | Deployment service principal passwords; auth-proof client secrets | `~/.scimserver-deploy/*.json` | **Recoverable by REGENERATION.** `setup-deploy-sp.ps1` and `setup-auth-proof-apps.ps1` reissue them. A reset also revokes whatever leaked, so reissuing beats restoring. |
| **1** | Connection strings for an estate whose tenant has **expired** (`db-urls.json` -> `T08_*`) | this machine only | **Cannot be re-read from Azure by any means**, because expiry kills the ARM control plane while PostgreSQL keeps serving. |

**Tier 1 sounds worse than it is, and the reason matters.** Those connection strings are a rollback path to the tenant-08 databases, and that data has **already been carried into tenant 09 and verified** - 58 endpoints, 728 and 734 users, 347 groups, all 58 x 6 per-endpoint surfaces, live SCIM 1401/1401. So losing them costs a forensic comparison, not the data.

**The real recovery dependency is not the secrets at all.** It is: the repository (on GitHub), the Azure CLI, and the ability to sign in as an administrator. With those three, a fresh workstation can rebuild every credential from scratch. Nothing in this estate is bootstrapped from a secret that exists in only one place.

**Optional hardening** - [scripts/backup-deploy-secrets.ps1](../scripts/backup-deploy-secrets.ps1) writes the residue to a single encrypted, portable file (AES-256-CBC, encrypt-then-MAC with HMAC-SHA256, PBKDF2-HMAC-SHA256 at 600,000 iterations, random salt and IV per file). The MAC covers the header as well as the body, and is checked before any decryption is attempted. Its crypto is proven by [test-backup-deploy-secrets.ps1](../scripts/test-backup-deploy-secrets.ps1): round-trip fidelity, wrong-passphrase rejection, single-bit ciphertext tampering, KDF-salt tampering, and non-reuse of salt/IV across runs.

```powershell
pwsh -File scripts/backup-deploy-secrets.ps1 -Action backup    # prompts for a passphrase, then self-verifies
pwsh -File scripts/backup-deploy-secrets.ps1 -Action verify    # prove it opens - do this BEFORE you need it
pwsh -File scripts/backup-deploy-secrets.ps1 -Action inspect   # header only, no passphrase, no secrets
```

Two rules that make the difference between a backup and a comforting file:

1. **The passphrase must be retrievable without the machine being backed up.** A passphrase stored only on that machine protects nothing.
2. **Treat a restored credential as a leaked one and rotate it immediately.** The archive embeds its own recovery instructions so they cannot drift away from it.

---

## 10. Drift and gap register

Every item below is a **measured** condition on the capture date, not a hypothetical. Severity reflects operational impact, not code quality.

| ID | Severity | Finding | Evidence | Impact | Suggested action |
|---|---|---|---|---|---|
| **G1** | ~~High~~ **CLOSED 2026-08-12** | ~~Canary prod has **11 active revisions, each running 1 replica**~~ - the tenant-09 estate was provisioned fresh and is pruned: canary prod has **1 active revision** at 100 %, dev has **2** (serving + rollback target), which is exactly the `-Keep 2` policy | `az containerapp revision list` on both apps | Connection demand is now 2 x 5 = 10 against `max_connections` 50 on dev and 1 x 5 = 5 on canary prod, comfortably inside budget | **Closed.** [prune-revisions.ps1](../scripts/prune-revisions.ps1) is wired into `promote-to-prod.ps1` and pipeline stage 6.2, so it runs by construction |
| **G2** | Medium | `scimserver-dev-vnet` (East US) is provisioned but referenced by nothing; the dev app uses `scimserver-env`, which lives in RG `scimserver-prod` | `az resource list` plus the dev app's `environmentId` pointing at `scimserver-env` in `scimserver-prod` | Dead resource; also means dev has **no** network isolation from canary prod, and dev's lifecycle is coupled to the prod resource group | Either delete it, or give dev its own environment bound to it. Carried forward from the previous estate because the migration reproduced the topology deliberately |
| **G3** | ~~Medium~~ **CLOSED 2026-08-12** | ~~Production estates run **Node.js v25.9.0**~~ - **all four live estates now run an Active LTS runtime**: dev `v24.19.0`, canary prod `v24.18.1`, calmsand `v24.18.1` | `/scim/admin/version` -> `runtime.node` on each estate. [endoflife.date/nodejs](https://endoflife.date/nodejs) | The EOL runtime exposure that ran for roughly two months is fully retired | **Closed.** Stage 1.10 gates the source Dockerfile and Stage 1.11 check C4 gates the deployed artifact, so a recurrence fails a gate rather than waiting for an operator to notice |
| **G3a** | ~~Medium~~ **CLOSED 2026-08-12** | ~~The canary's JWKS host allowlist is missing `login.windows.net`~~ - both tenant-09 estates publish the full **7-host** allow-list including `login.windows.net` | `GET /scim/admin/settings/jwks-hosts` on dev and canary prod; live assertions `9z-AV.T7/T8` and `9z-BK.T2/T3/T4` pass on both | v1 Entra issuers (`login.windows.net`) verify correctly on every estate | **Closed at two layers.** The row was carried in the migrated data, *and* `login.windows.net` was added to `WELL_KNOWN_JWKS_HOST_SEED` in [jwks-host-allowlist.service.ts](../api/src/oauth/jwks-host-allowlist.service.ts) so a future greenfield estate seeds it too. See the note under G16 for why the seed layer mattered |
| **G4** | Medium | Application and database are in **different regions** (apps East US, databases East US 2) | `az containerapp show` location vs `az postgres flexible-server list` location | Adds cross-region latency to every query and a cross-region egress charge | Accept and document, or co-locate on the next database rebuild. Reproduced deliberately in tenant 09 so behaviour matches the previous estate |
| **G5** | ~~Medium~~ **CLOSED 2026-08-12** | ~~Temporary personal-IP firewall rules persist on both databases~~ - the tenant-09 servers carry **only** `AllowAllAzureServices` | `az postgres flexible-server firewall-rule list` on both servers | No standing developer-IP exceptions | **Closed** by not recreating them. If one is added for a debugging session, delete it in the same session |
| **G6** | ~~Medium~~ **CLOSED 2026-08-12** | ~~ACR has `adminUserEnabled: true` and dev authenticates with that admin credential~~ - `acrscimsrv09` has `adminUserEnabled: **false**`, and **no app references it**; both apps pull anonymously from GHCR and both carry `identity: SystemAssigned` | `az acr show -n acrscimsrv09`; both apps' `registries[]` are empty | No shared long-lived registry credential exists | **Closed.** See [Section 7](#7-image-supply-chain) for why ACR was left off the serving path rather than wired up with an `AcrPull` assignment |
| **G7** | ~~Low~~ **CLOSED 2026-08-12** | ~~Canary prod's `registries[]` entry names an ACR server with a `ghcr-password` secret while the running image is GHCR~~ - neither tenant-09 app has any `registries[]` entry | `az containerapp show` registries vs image on both apps | The misleading credential mapping is gone; the image source is unambiguous during incident response | **Closed** |
| **G8** | Low | ACR `acrscimsrv09` holds three tags but is on no deployment path, and its retention policy is unconfigured | `az acr show`; no app references it | A Basic-SKU registry accruing storage for no consumer | Delete it, or wire it in properly with an `AcrPull` role assignment. Note it is also named after a tenant generation (see G15) |
| **G9** | ~~Low~~ **CLOSED 2026-08-11** | `azure.extensions` drift: canary prod had `UUID-OSSP` in addition to the three the deploy script set; dev did not | `az postgres flexible-server parameter show --name azure.extensions` | **The predicted failure happened, in the opposite direction to the one written here.** This row warned that "a migration depending on `uuid-ossp` would pass prod and fail dev". What actually broke was a *restore*: `pg_dump` of the prod source emits `CREATE EXTENSION "uuid-ossp"`, and Azure rejects that against a target whose allow-list omits it, so the tenant-08 to tenant-09 **canary-prod carry failed while the dev carry succeeded** - the drift made the failure look environment-specific when it was data-specific | **Closed.** [deploy-azure.ps1](../scripts/deploy-azure.ps1) now provisions all four - `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP` - so a newly provisioned server can receive a dump from any existing estate. Both live tenant-09 servers verified at all four |
| **G10** | Low | `Dockerfile.optimized` and `Dockerfile.ultra` are unreferenced and still declare `DATABASE_URL="file:./data.db"` with `prisma db push` | grep of all workflows, compose files, and deploy scripts | A reader or future script could pick a dead SQLite-era Dockerfile. This is exactly the failure mode behind the 2026-07-29 Node-25 EOL escape, where a spot-check hit the wrong Dockerfile | Delete both, or move them under an `archive/` path with a header stating they are not shipped |
| **G11** | Low | [infra/acr.bicep](../infra/acr.bicep) is declared but deployed by no script; the live ACR was created out-of-band | grep for `acr.bicep`; `az acr show` | Infrastructure-as-code does not describe a live resource | Either wire it into `deploy-azure.ps1` and reconcile, or delete it alongside G8 |
| **G12** | Low | `CREDENTIAL_KEK` is not set by [infra/containerapp.bicep](../infra/containerapp.bicep), so all Azure estates run on the default `changeme-credential-kek` | Bicep env list; [credential-kek.ts](../api/src/security/credential-kek.ts) | Re-viewable credential secrets are wrapped with a publicly known KEK. Not on the auth path (token verification uses the bcrypt hash), so this is confidentiality-at-rest only | Add a `credential-kek` secret + env mapping to the template and set a private, deploy-stable value |
| **G13** | ~~Info~~ **CLOSED 2026-08-12** | ~~Dev runs `activeRevisionsMode: Single` while both prods run `Multiple`~~ - dev is now `Multiple`, matching both prods | `az containerapp show --query properties.configuration.activeRevisionsMode` | Dev can now exercise the same revision model prod depends on | **Closed** as a side effect of fresh provisioning |
| **G14** | ~~Info~~ **CLOSED 2026-08-24** | ~~Customer prod (calmsand) remains at **0.55.1**~~ - **all three estates are now at 0.55.13**. calmsand was promoted on the operator's explicit go-ahead once the MSDN budget reset re-enabled its subscription | `/scim/admin/version` on all four estates | The version spread that had opened to 12 patches is closed; the estates are back in lockstep | **Closed.** The promotion carried 94 commits but **zero Prisma migrations**, so the customer database schema was untouched |
| **G15** | **Medium** | **The active subscription is ephemeral and its resource names encode a tenant generation.** `acrscimsrv09`, `scimserver-pg-09` and `scimserver-pg-dev-09` all carry an `09` that becomes wrong at the next tenant rollover, and the subscription itself has a limited life (the previous one lasted roughly 80 days) | Resource names in [Section 4](#4-live-estates---measured-configuration); the 2026-08-11 expiry of the predecessor | This whole migration is a **recurring** operation, roughly 4 to 5 times a year, and generation-stamped names guarantee either a rename or a lie at each turn. A name that encodes a fact that expires is a scheduled defect | Adopt generation-free names on the next rebuild, and drive estate identity from a declarative registry keyed by role (`active` / `next` / `retiring` / `permanent`) rather than by hard-coded names or FQDNs. Tracked as the follow-on generalization work |
| **G16** | **Medium** | **The retiring tenant-08 estates are still serving but can no longer be managed.** Their ARM control plane expired on 2026-08-11; the containers and PostgreSQL data plane are unaffected | `az` against subscription `5738ea6a-...` fails; the `proudbush-ae90986e` FQDNs still answer | They cannot be scaled, redeployed, patched or deleted, and they will keep answering on the public internet until Azure reclaims the subscription. Anything still pointed at those URLs will keep working and will therefore not notice it is on a dead estate | Confirm nothing points at them (done: every script, gate, prompt and doc now targets `purplecliff-91e4026d`), and let them lapse. **The transferable lesson: subscription expiry kills ARM but not the data plane** - capture database connection strings *before* the boundary and store them outside the tenant, which is exactly what made the 2026-08-12 recovery possible |


---

## 11. Cost model

Verified rate card from the [Azure Container Apps pricing page](https://azure.microsoft.com/en-us/pricing/details/container-apps/) (Consumption plan, pay-as-you-go, fetched 2026-07-29):

| Meter | Active rate | Idle rate | Free grant per subscription per month |
|---|---|---|---|
| vCPU | `$0.000024` per vCPU-second | `$0.000003` per vCPU-second | 180,000 vCPU-seconds |
| Memory | `$0.000003` per GiB-second | `$0.000003` per GiB-second | 360,000 GiB-seconds |
| Requests | `$0.40` per million | n/a | 2,000,000 requests |

A replica is considered **active** when vCPU usage exceeds 0.01 cores or received data exceeds 1,000 bytes per second; otherwise a `minReplicas`-pinned replica bills at the idle rate.

### What that means for this estate

One always-on replica at 0.5 vCPU / 1 GiB consumes, per 30-day month:

- vCPU: `0.5 x 2,592,000 = 1,296,000` vCPU-seconds
- Memory: `1 x 2,592,000 = 2,592,000` GiB-seconds

Both exceed the free grant, so the grant covers roughly the first 14 % of vCPU-seconds and 14 % of GiB-seconds for a single replica. The dominant lever is therefore **replica count**, which is exactly what finding **G1** is about: the canary prod is currently paying for 11 replicas to serve one revision's traffic.

```mermaid
pie showData
    title "Canary prod replicas by traffic weight (measured 2026-07-29)"
    "Serving traffic (green-0714-1458)" : 1
    "Idle stale revisions still running 1 replica each" : 10
```

The repo's own estimate, printed by [scripts/deploy-azure.ps1](../scripts/deploy-azure.ps1) at the end of a greenfield deploy, is **$20-45 per month** for a single estate: Container App $5-15, Log Analytics $0-5, PostgreSQL B1ms $15-25. Region-specific unit prices for PostgreSQL Flexible Server, Azure Container Registry, and Log Analytics change often enough that they are deliberately not restated here - use the [Azure pricing calculator](https://azure.microsoft.com/en-us/pricing/calculator/) and see [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md), which is the canonical cost doc and carries the pause/resume/delete cost-control commands.

---

## 12. Verification recipes

Everything below is copy-pasteable and re-derives the facts in this document.

### Azure control plane (ProvIAM tenant 09: dev + canary prod)

Two subscriptions are named `ProvIAM_Subscription` - the active tenant-09 one and the expired tenant-08 one - so **always select by subscription ID, never by name**. [scripts/az-tenant.ps1](../scripts/az-tenant.ps1) does this for you (`Use-ProvIAM09`), and `Show-ScimTenants` prints every tenant, subscription and service principal with both its name and its ID.

```powershell
az account set --subscription 8cb58fd6-cf6f-4334-9fe0-3b12f93a6596

# Full resource inventory
az resource list --query "[?starts_with(resourceGroup,'scimserver')].{rg:resourceGroup,name:name,type:type,location:location,sku:sku.name}" -o table

# Container Apps
az containerapp show -n scimserver     -g scimserver-prod -o json
az containerapp show -n scimserver-dev -g scimserver-dev  -o json

# Revisions, replicas and traffic (finding G1)
az containerapp revision list -n scimserver -g scimserver-prod `
  --query "[].[name,properties.active,properties.replicas,properties.runningState,properties.trafficWeight]" -o tsv

# Managed environment (note: it lives in RG scimserver-prod and is shared by BOTH apps)
az containerapp env show -n scimserver-env -g scimserver-prod -o json

# PostgreSQL
az postgres flexible-server list -o table
az postgres flexible-server parameter show -g scimserver-prod -s scimserver-pg-09 --name max_connections   -o tsv
az postgres flexible-server parameter show -g scimserver-prod -s scimserver-pg-09 --name azure.extensions  --query value -o tsv
az postgres flexible-server firewall-rule list -g scimserver-prod -n scimserver-pg-09 -o table

# Networking
az network vnet list --query "[?starts_with(name,'scimserver')]" -o json

# Registry (provisioned but NOT on the serving path - see G8)
az acr show -n acrscimsrv09 -o json
az acr repository show-tags -n acrscimsrv09 --repository scimserver --orderby time_desc --top 10 -o tsv
```

**If `az containerapp` reports `'environment' is misspelled or not recognized by the system`, you are missing the extension, not the resource.** `az` stores extensions under `$AZURE_CONFIG_DIR/cliextensions`, so the per-tenant profile directories this repo uses for simultaneous multi-tenant login each start with an empty extension set. The error text never mentions extensions and reads like a typo or a deleted resource; during the 2026-08-12 migration it produced an empty inventory for a fully healthy estate. `az-tenant.ps1` now points `AZURE_EXTENSION_DIR` at one shared directory whenever it switches profiles. To reproduce by hand:

```powershell
$env:AZURE_CONFIG_DIR    = "$HOME\.azure-proviam09"
$env:AZURE_EXTENSION_DIR = "$HOME\.azure\cliextensions"
```

### Azure control plane (AnandSa tenant: customer prod)

```powershell
az login --tenant 9de357c6-4488-4a8d-bd2f-14696f1af950
az account set --subscription AnandSa-Test-150
az containerapp show -n scimserver-prod -g scimserver-rg-prod -o json
```

### Data plane (works for all three, no Azure credentials needed)

```powershell
$base = 'https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io'

Invoke-RestMethod -Uri "$base/scim/health"

$body = @{
  grant_type    = 'client_credentials'
  client_id     = 'scimserver-client'
  client_secret = 'changeme-oauth'
} | ConvertTo-Json

$tok = Invoke-RestMethod -Uri "$base/scim/oauth/token" -Method Post `
  -ContentType 'application/json' -Body $body

Invoke-RestMethod -Uri "$base/scim/admin/version" `
  -Headers @{ Authorization = "Bearer $($tok.access_token)" } | ConvertTo-Json -Depth 6
```

`/scim/admin/version` self-reports the estate's own infrastructure, which is why it works across the tenant boundary. Measured shape (customer prod, values abbreviated):

```json
{
  "version": "0.54.0-alpha.11",
  "service": {
    "name": "SCIMServer API",
    "environment": "production",
    "apiPrefix": "scim",
    "scimBasePath": "/scim/v2"
  },
  "runtime": {
    "node": "v25.9.0",
    "platform": "linux",
    "arch": "x64",
    "pid": 1,
    "hostname": "scimserver-prod--green-0714-1516-6cc6df8d44-5hzd5",
    "cpus": 4,
    "containerized": true
  },
  "auth": {
    "oauthClientSecretConfigured": true,
    "jwtSecretConfigured": true,
    "scimSharedSecretConfigured": true
  },
  "storage": {
    "databaseProvider": "postgresql",
    "persistenceBackend": "prisma",
    "connectionPool": {
      "maxConnections": 5
    }
  },
  "container": {
    "database": {
      "host": "scimserver-prod-pg.postgres.database.azure.com",
      "port": 5432,
      "name": "scimdb",
      "provider": "PostgreSQL 17"
    }
  },
  "deployment": {
    "resourceGroup": "scimserver-rg-prod",
    "containerApp": "scimserver-prod",
    "registry": "ghcr.io"
  }
}
```

### Logs

```powershell
az containerapp logs show -n scimserver -g scimserver-prod --type console --tail 50
az containerapp logs show -n scimserver -g scimserver-prod --type system  --tail 30
pwsh scripts/remote-logs.ps1 -BaseUrl https://scimserver-dev.purplecliff-91e4026d.eastus.azurecontainerapps.io
```

---

## 13. Reference - external sources

| Topic | Source |
|---|---|
| Container Apps pricing (rate card in Section 11) | https://azure.microsoft.com/en-us/pricing/details/container-apps/ |
| Container Apps revisions and traffic splitting | https://learn.microsoft.com/en-us/azure/container-apps/revisions |
| Container Apps blue/green deployment | https://learn.microsoft.com/en-us/azure/container-apps/blue-green-deployment |
| Container Apps VNet integration | https://learn.microsoft.com/en-us/azure/container-apps/networking |
| Container Apps health probes | https://learn.microsoft.com/en-us/azure/container-apps/health-probes |
| PostgreSQL Flexible Server compute and storage | https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-compute |
| PostgreSQL Flexible Server limits (incl. `max_connections` by SKU) | https://learn.microsoft.com/en-us/azure/postgresql/flexible-server/concepts-limits |
| Azure Container Registry SKUs | https://learn.microsoft.com/en-us/azure/container-registry/container-registry-skus |
| Node.js release and support schedule | https://nodejs.org/en/about/previous-releases and https://endoflife.date/nodejs |
| Azure pricing calculator | https://azure.microsoft.com/en-us/pricing/calculator/ |

---

## 14. Self-improvement and design/architecture gate disposition

Per the standing R7 (test/gate self-improvement) and Design & Architecture gate rules.

**What this audit revealed that the current gate set does not cover.**

| Observation | Existing gate that should have caught it | Verdict |
|---|---|---|
| G1 - 11 active revisions, 55 pooled connections against `max_connections=50` | None. `promote-to-prod.ps1` creates revisions and flips traffic but never deactivates the loser; no gate inspects revision count, replica count, or aggregate connection demand | **Gap. Scheduled** - add a post-flip deactivation step plus a Stage 4 assertion that `active revision count x pool size < max_connections` |
| G3 - both prods running an EOL Node runtime while the source is on LTS | `scripts/audit-base-images.ps1` (Stage 1.10) gates the **Dockerfile**, not the **deployed artifact** | **Closed (a) applied** - [audit-deployment-doc.ps1](../scripts/audit-deployment-doc.ps1) check **C4** (`-Live`) reads `runtime.node` from `/scim/admin/version` on every estate and fails when the major is not Active/Maintenance LTS. Source and deployed checks share one LTS table ([node-lts.ps1](../scripts/node-lts.ps1)) so they cannot drift apart. The finding itself stays open until the prods are promoted |
| G9 - `azure.extensions` drift between dev and prod | None | **Closed (a) applied** - the deploy script now provisions the superset including `UUID-OSSP`, so the list is authoritative and a dump from any estate restores anywhere. Still **scheduled**: asserting the live value matches that list during verification, which is what would have caught the drift before a migration depended on it |
| G12 - `CREDENTIAL_KEK` absent from the Bicep template | `endpointConfigFlagAudit` covers endpoint flags, not deployment env vars | **Gap. Scheduled** - add an env-var completeness check comparing the Bicep env list against the vars `api/src` actually reads |
| G10 / G11 - dead Dockerfiles and an undeployed Bicep template | None; and this is the exact shape of the 2026-07-29 wrong-Dockerfile escape | **Partly closed (a) applied** - check **C3** now fails when any `Dockerfile*`, `docker-compose*.yml` or `infra/*.bicep` exists that this doc never names, so a new or dead element cannot stay invisible. Still **scheduled**: asserting each element is *referenced by a workflow/compose/script* or explicitly marked archived |
| **Doc rot itself** - this document silently going stale | None; documentation has never been gated in this repo | **Closed (a) applied** - checks **C1** (infra changed => doc must change) and **C2** (`Last verified` within 90 days), wired as Stage 1.11. See [Section 0.1](#01-maintenance-contract---this-is-a-living-document) |

**Design/architecture disposition for this change.** This commit adds documentation only; it introduces no class, no dependency edge, and no abstraction. SRP, coupling, pattern-consistency, and open/closed are not engaged. The YAGNI counter-check applies to the doc itself: it deliberately does **not** duplicate the cost/load tables owned by [DEPLOYMENT_INSTANCES_AND_COSTS.md](DEPLOYMENT_INSTANCES_AND_COSTS.md) or the walkthrough owned by [AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md](AZURE_DEPLOYMENT_AND_USAGE_GUIDE.md); it cross-links them instead. **Disposition: (a) applied** for the documentation scope, **(b) scheduled** for the five gate gaps listed above.

---

## 15. Change log

| Date | Change |
|---|---|
| 2026-08-25 (latest) | **Two deployment gates that could not fail were closed, and three mandated static gates were wired in for the first time.** (1) [verify-deployment.ps1](../scripts/verify-deployment.ps1) excludes the pixel-baseline specs with `--grep-invert`, which is correct because those baselines are coupled to fixture data that differs per estate - but **an excluded test appears in no pass/skip/fail count**, so every customer-prod verification reported `196 passed` while carrying **zero** visual-regression coverage and saying nothing about it. It now prints `223 collected, 23 excluded, 200 will run`, fails when the filter leaves nothing to run, and fails when the three counts do not balance, so an over-broad pattern cannot silently delete coverage. Negative control: adding `|Settings` to the pattern excludes **57** instead of 23. **A skipped test is visible; an excluded one is not, and that difference is the whole defect.** (2) [dev-deployment-pipeline.ps1](../scripts/dev-deployment-pipeline.ps1) recorded all **11** Stage 3 audits as `PENDING` at 0 s via an unconditional loop with no execution path - they could never return PASS and were explicitly non-blocking for the canary, so 11 of 39 gates were decorative. `endpointConfigFlagAudit` and `dependencyCveSweep` (production-only audit, CRITICAL blocks, plus `.trivyignore` staleness) now execute; the remaining eight are genuine reviewer-judgement gates and are labelled as such rather than pretending to be automatable. (3) Stages **1.9** (`prismaMigrationAudit` - a `schema.prisma` edit with no migration deploys code expecting columns the database lacks, and that surfaces at container start rather than in CI), **1.10** (base-image LTS) and **1.11** (deployment-doc currency) were mandated but had **never been wired into the pipeline** - only into pre-push. All three now run there. |
| 2026-08-24 (latest) | **v0.55.13 promoted to customer prod (calmsand); all three estates aligned, and G14 closed.** The MSDN budget reset re-enabled the AnandSa subscription (`state: Enabled`), and the operator gave the explicit go-ahead. **This was audited as a release, not a re-tag, because calmsand sat 12 versions back at 0.55.1** - a diff of **94 commits / 212 files / 48 shipped-code files**. The pre-flight finding that governed the risk was `prismaMigrationAudit`: **zero migrations in the range and `schema.prisma` unchanged**, so nothing touched the schema behind 2,000+ real customer users. The digest `sha256:36101b88` was byte-identical to the one proudbush had soaked since 20 Aug. True blue/green with post-flip verification: **live SCIM 1,435/1,435, Playwright 196 passed / 4 skipped, endpoints 57 -> 57 with 0 missing IDs.** Revision hygiene then pruned 3 active to 1 per `revisionKeep: 1`, so **there is no rollback target - recovery is roll-forward** with a previous `-ImageTag`. **Two lessons worth keeping.** (1) A prior attempt was lost when the machine became unresponsive mid-run; the first post-restart action was to prove calmsand was still 0.55.1/57 with **no orphan 0% green revision** - an interrupted blue/green must be shown clean before retry, never assumed clean, because a half-applied flip and a never-started one look identical from the FQDN. (2) The CVE sweep produced its first real finding and needed splitting rather than waving: 8 high (api) / 12 high (web) collapses to **web zero in production** and **api 5, all the `prisma` CLI chain**. `prisma` is a devDependency that **nonetheless ships**, because [api/docker-entrypoint.sh](../api/docker-entrypoint.sh) runs `migrate deploy` at start - so "devDependency" was not a valid dismissal, and the reachability argument (start-time only, our own files, no attacker input, nothing on the request path) had to be made explicitly. **ACCEPTED** here, **SCHEDULED** as the next release since `fixAvailable` is true throughout |
| 2026-08-20 (latest) | **The dev deploy now pulls from GHCR, because ACR was never a working pull path for it.** The pipeline deployed `acrscimsrv09.azurecr.io/scimserver:<tag>` and Azure refused the revision with `UNAUTHORIZED: authentication required`. Measured cause: the dev Container App has **no registry credentials at all** (`properties.configuration.registries` is empty) and a `SystemAssigned` identity with no AcrPull assignment - it has always pulled the **public GHCR** image anonymously, which is why every manual deploy worked while the pipeline's did not. Rather than grant ACR pull rights, the deploy step now uses `$RegistryGhcr:<version>`, matching how the app is actually configured and keeping ACR as a **mirror** rather than a deploy dependency. Two smaller end-to-end fixes in the same pass: the revision suffix is now **sanitized** (`v0.55.13` is invalid - Azure forbids `.` in a suffix - and becomes `v0-55-13`, verified across four version shapes), and the Docker phase retires the pipeline's **own** Stage-2 E2E database before `compose up`, because it holds host port 5432 and the conflict otherwise surfaced as an opaque `Bind for 0.0.0.0:5432 failed` two stages later. **Azure rejected the bad revision rather than applying it, so dev kept serving the previous image throughout** - the failure was loud and safe, which is the behaviour to preserve |
| 2026-08-20 (latest) | **Both deployment pipelines now fail for the right reason instead of an unrelated one.** Two end-to-end blockers hit on the 0.55.12 run were fixed in the scripts rather than in an operator's memory. (1) `full-validation-pipeline.ps1` built with `docker compose build --no-cache` and no registry argument, so on a network that blocks the public npm registry every `npm ci` stage hung. It now **probes container egress** and, when blocked, falls back to whatever registry the **host's own npm** is configured with (`npm config get registry`) - deliberately not a hardcoded corporate URL, so the same logic works on any machine and needs no per-site edit. (2) `dev-deployment-pipeline.ps1` resolved the dev FQDN from ARM and carried on when the lookup returned **empty**, which is exactly what an **expired tenant** does - ARM does not error, it returns nothing - and the run then built `https:///scim/oauth/token` and died at Stage 0 with `Invalid URI`. It now throws immediately, prints the tenant the `az` session actually reports, and names the fix (`. ./scripts/az-tenant.ps1; Use-ProvIAM09`). Both are instances of the same lesson: **a blank result is the failure mode to design for, because it does not look like one.** |
| 2026-08-20 (latest) | **Local `docker build` was restored, and the reason it broke is a lesson about caches rather than about networks.** `docker build` began failing at `RUN npm ci` with npm's generic `Exit handler never called!`, reproducibly at ~72s. Measured cause: **the public npm registry is unreachable from this device entirely** - the host gets `The SSL connection could not be established` and a container gets `Connection reset by peer`. The host only works because `~/.npmrc` redirects npm to `https://packagefeedproxy.microsoft.io/npm/`, and **a container does not inherit `~/.npmrc`**. That block dates from **2026-07-09** (the `~/.npmrc` mtime) and was already written down on 2026-07-30 in the Stage 6.1 lockfile rule - but only for *lockfile regeneration*, never connected to the image build. Local builds kept succeeding for six weeks purely because BuildKit reused the cached `npm ci` layer; the 0.55.12 version bump edited `package.json`, invalidated `COPY api/package*.json`, and forced the first real install since. **A layer cache can mask a hard environmental break indefinitely and surfaces it at the worst possible moment.** Fix: `Dockerfile` now takes `ARG NPM_REGISTRY` (defaulting to the **public** registry so CI is untouched) threaded into all three `npm ci` stages, and `docker-compose.yml` passes it through as `${NPM_REGISTRY:-https://registry.npmjs.org/}`. **Verified end to end**: image builds locally via the proxy, starts against PostgreSQL, and passes live SCIM **1429/1429**. Safety was checked rather than assumed - `npm ci` never rewrites the lockfile (byte-identical, `git status` clean), every `resolved` stays `registry.npmjs.org`, every `integrity` stays `sha512`, and no credential enters the build, so this is a **transport** override and not the forbidden operation of regenerating a lockfile against an internal feed. Four industry approaches were compared (registry override, BuildKit secret-mounted `.npmrc`, vendoring, CI-only); the secret mount was rejected because the host `.npmrc` carries an unrelated Azure DevOps password. Full analysis: [LOCAL_DOCKER_BUILD.md](LOCAL_DOCKER_BUILD.md). CI remains the **authoritative** image builder |
| 2026-08-14 (latest) | **Revision retention became per-estate policy in the registry, and customer prod dropped to 1 for cost.** On 2026-08-14 the AnandSa subscription behind customer prod (calmsand) hit its **MSDN $150/month spending limit** and was **disabled** - the managed environment reported `ManagedClusterSuspended`, the container app `provisioningState: Failed` with a null FQDN, and the PostgreSQL server `Disabled` with port 5432 unreachable. The portal shows it reactivating automatically on 2026-08-21 with the next billing period, so this was budget exhaustion rather than a lost estate; all five resources were retained and the same 58 endpoints exist on canary prod. Measured while diagnosing it: **Log Analytics is not a driver** (0.383 GB billable over 30 days on the canary, about $1/month) and no resource had been added since 2026-05-22, so the cost is **always-on Container Apps compute** - and an active revision at 0% traffic runs its own replica, which is why the 2026-07-31 revision-hygiene work matters financially as well as for `max_connections`. Customer prod therefore now keeps **1** revision instead of 2, roughly halving its compute, at the cost of the instant-rollback target. To stop that number being a literal copied into each caller, `revisionKeep` is now a field on every estate in [scim-estates.json](../scripts/scim-estates.json); [prune-revisions.ps1](../scripts/prune-revisions.ps1) resolves it when `-Keep` is omitted, and both [promote-to-prod.ps1](../scripts/promote-to-prod.ps1) and [dev-deployment-pipeline.ps1](../scripts/dev-deployment-pipeline.ps1) stage 6.2 read it rather than deciding for themselves. New validator rule **R8** rejects a registry where an estate drops below 2 without being `customer-prod` AND carrying a `revisionKeepRationale`, because an unexplained 1 is indistinguishable from a typo and a typo there silently deletes a rollback path; 6 negative controls and a positive control cover it in [test-scim-estates.ps1](../scripts/test-scim-estates.ps1). `promote-to-prod.ps1` now prints the **roll-forward** recovery command on an estate that keeps 1, because printing the instant-rollback command would name a revision that no longer exists - discovered only while trying to recover |
| 2026-08-13 (latest) | **Estate identity became a registry instead of 97 hardcoded strings, and the C4 live gate now follows a rollover on its own.** The 2026-08-12 cutover required **97 identity replacements across 28 files**, and that bulk edit silently rewrote the *retiring* tenant's entry in the tenant map to the *new* tenant's ids - corrupting the one file whose job is to hold the two apart. No gate could catch it, so the fix is not a better gate but removing the need for the bulk edit. New [scim-estates.json](../scripts/scim-estates.json) declares tenants and estates keyed by **role**; [scim-estates.ps1](../scripts/scim-estates.ps1) resolves them and **derives** every FQDN from ARM, because Azure assigns the environment domain at creation and a stored FQDN is a value guaranteed to go false. A cutover becomes `Set-ScimEstateRole`, validated before it is written so the registry cannot be left with zero or two active estates for a purpose. [test-scim-estates.ps1](../scripts/test-scim-estates.ps1) carries 9 checks **all proven to fire**, plus a positive control; **R3 reproduces the exact bulk-edit defect**. New [replicate-estate.ps1](../scripts/replicate-estate.ps1) encodes the migration as phased preflight/carry/verify/cutover, defaults to preflight, refuses customer-prod as a target and refuses to carry without `-Confirm`. Its verify phase adds the check the migration lacked: **server-level state**, compared against the SOURCE when reachable - every verification on 2026-08-12 was resource-shaped and all of it passed while the JWKS allow-list had reverted to its seed, because counts cannot see a singleton. **Wiring C4 to the registry exposed two defects in that very change**: the `$token` assignment was dropped so every estate returned 401, and C4 classified 401 as "not reachable, skipped, not failed" - **silently disabling the check while still reporting PASS**. A 401 is not unreachable; the estate answered and we presented the wrong credential. It is now a failure, proven by negative control. Full comparison of both migrations: [TENANT_MIGRATION_COMPARISON_AND_LEARNINGS.md](TENANT_MIGRATION_COMPARISON_AND_LEARNINGS.md) |
| 2026-08-12 | **v0.55.6 deployed to both tenant-09 estates, which is also the proof that the redirected deployment path works.** The cutover commit repointed every script, gate, prompt, spec and doc at `purplecliff-91e4026d`, but a textual redirect proves only that the files read correctly. Deploying through that path proves it **functions**: image built from master by [publish-ghcr.yml](../.github/workflows/publish-ghcr.yml), pulled anonymously from GHCR, digest-pinned to `sha256:435c6dc2...f1d2` on dev and on the canary, traffic flipped on the canary only after its new revision reported `Healthy`, and both pruned to the `-Keep 2` policy. Live SCIM **1401/1401 on dev**. **The canary's previous 7 failures disappeared exactly as predicted**: they were JWKS numeric-bound assertions for a feature introduced in 0.55.3 while the canary still ran 0.55.1, diagnosed by locating the introducing commit rather than by inspecting the estate, then confirmed by the version moving. The release also makes `login.windows.net` correct in the **seed** rather than only in the persisted rows - measured before as `seed 6 / persisted 7 / effective 7` and after as `seed 7 / persisted 7 / effective 7`, so a future greenfield estate gets the v1 Entra host with no operator action |
| 2026-08-12 | **Dev and canary prod moved to a new Azure AD tenant, carrying everything.** The ephemeral subscription hosting both estates was expiring, so the full estate was rebuilt in tenant `9751e42f` (Provisioning IAM Team 09, subscription `8cb58fd6-...`, environment domain `purplecliff-91e4026d`) and every table was carried across: **58 endpoints, 728 users and 347 groups to canary prod; 58 endpoints, 734 users and 347 groups to dev**, with primary keys preserved so existing SCIM client configurations keep resolving. Verification actually run: a per-surface deep verify of **all 58 endpoints x 6 surfaces** (profile, schemas, resource types, ServiceProviderConfig, settings, config flags) plus the global surfaces on both estates - **OVERALL PASS** on each, with 296 and 319 attribute definitions confirmed RFC-valid; live SCIM **1387/1387** against tenant-09 dev; Playwright **207 passed / 0 failed** in real Chromium. **Customer prod (calmsand) was never contacted**, and the two tenant-08 estates were deliberately left running and untouched (see **G16**). Four findings worth carrying forward. (1) **The old tenant's ARM control plane expired mid-migration, on 2026-08-11.** Recovery was possible only because the PostgreSQL connection strings had been captured *before* the boundary and stored outside the tenant - **subscription expiry kills the control plane, not the data plane**, and that asymmetry is the single most useful thing to know when a tenant is on a clock. (2) **A migration can carry every row and still lose server-level state.** Endpoint, user, group and credential counts all matched, every per-endpoint surface passed, and yet the JWKS host allow-list had silently reverted to its seeded default - a security-relevant control that no count-based or per-endpoint check looks at. It is fixed at both layers: the row is carried, *and* `login.windows.net` was added to `WELL_KNOWN_JWKS_HOST_SEED` with explicit per-host regression assertions, because the previous test only iterated the constant and so could not detect a removal. (3) **`az` extensions live under `AZURE_CONFIG_DIR`**, so the per-tenant profile isolation this repo relies on for simultaneous multi-tenant login also gives each tenant an empty extension set - reported as `'environment' is misspelled or not recognized by the system`, which reads like a typo and produced an empty resource inventory for a completely healthy estate. `az-tenant.ps1` now pins `AZURE_EXTENSION_DIR` to one shared directory on every profile switch. (4) **Two subscriptions share the name `ProvIAM_Subscription`**, so tenant resolution now keys on subscription **ID** and refuses an ambiguous name rather than silently selecting the wrong tenant. Gaps **G1, G3, G3a, G5, G6, G7, G13 closed**; new **G15** (resource names encode a tenant generation that expires) and **G16** (the old estates still serve but can no longer be managed) opened |
| 2026-08-12 | **Gap G9 closed - and it closed by failing, not by being noticed.** `azure.extensions` is now provisioned as the superset `CITEXT,PG_TRGM,PGCRYPTO,UUID-OSSP` by [deploy-azure.ps1](../scripts/deploy-azure.ps1). G9 had sat as a **Low**-severity row since 2026-07-29 predicting that "a migration depending on `uuid-ossp` would pass prod and fail dev". The real failure came from the other direction: the tenant-08 to tenant-09 **canary-prod data carry** failed because `pg_dump` of a source that HAS the extension emits `CREATE EXTENSION "uuid-ossp"`, which Azure rejects against a target that does not allow-list it. The dev carry succeeded on the same code because the dev source had three extensions and the prod source four - so a **data**-specific fault presented as an **environment**-specific one, which is the most expensive kind of misdirection. Two lessons recorded rather than just the fix: a Low-severity drift row is still a live fault, and provisioning the SUPERSET is the only setting under which a dump from any estate restores into any other. Also in this change: `rotate-tenant-data.ps1` now quiesces the target app for the duration of a restore, because restoring underneath a live replica races the application re-seeding tables between the DROP and the COPY - with the restart in a `finally` block so a failed copy cannot strand an estate at zero replicas |
| 2026-08-04 | **Two supply-chain gates added, and the second found six problems the image scan structurally cannot see.** A HIGH advisory against `fast-uri` blocked a push and exposed a conflict that is designed-in rather than unlucky: **Trivy fires the moment a fix is published** (`ignore-unfixed: true`, so every failure already has one) while **corporate policy forbids consuming any version younger than 7 days** - leaving a guaranteed window in which no compliant action makes the gate green. (a) `.trivyignore` entries now declare a `Class`: a `judgment` call is open-ended at 90 days, a `quarantine-window` is a **timing** hold capped at 14 days that must name its `Fixed-version:` and `Fix-available-from:`, and is flagged the moment the fix ages in **independent of `Re-check-by`**. Conflating the two is what let a 90-day default swallow a one-week wait - a 13x error. [trivyignore-review.yml](../.github/workflows/trivyignore-review.yml) accordingly moved **weekly -> daily**, because a weekly cron cannot police a seven-day deadline. (b) New [dependency-pins-review.yml](../.github/workflows/dependency-pins-review.yml) + [check-dependency-pins.ts](../api/src/scripts/check-dependency-pins.ts) watch the 8 packages pinned in `api/package.json` `overrides`. **An override freezes the version and Dependabot does not manage that block**, so a pin added to FIX one advisory becomes the VULNERABLE version of the next - which is exactly what `fast-uri@3.1.4` did. **Its first real run flagged 7 of the 8 pins, and 6 were medium and therefore invisible to Trivy**, which gates HIGH+CRITICAL only: `hono@4.12.25` (4), `@hono/node-server@1.19.10` (2), `fast-uri@3.1.4` (1 high). It carries **no semver dependency on purpose** - `semver` is transitive with no types, so importing it would be a phantom dependency and adding it would demand the lockfile regeneration this policy forbids locally. Neither gate blocks a push: both need the Advisory API, and a flaky blocking gate trades a real signal for an unreliable one. Also new: [validate-workflows.mjs](../scripts/validate-workflows.mjs), because a malformed workflow **fails no build - it simply never runs**; proven with a negative control before its green was believed. **This entry was demanded by C1**, which blocked the push the moment `.github/workflows/**` changed. Full procedure + decision diagram: [NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md](strategy/NPM_SUPPLY_CHAIN_QUARANTINE_POLICY.md) section 11. Repo version `0.55.1` -> `0.55.2` |
| 2026-07-31 (latest) | **Documentation currency became a gate, and [dev-deployment-pipeline.ps1](../scripts/dev-deployment-pipeline.ps1) gained Stage 1.12 to run it.** This document had been the *only* documentation this repo gated, and generalising that turned out to be overdue: **12 of 18 user-facing documents still advertised v0.53.0** while 0.55.1 shipped, one still said 0.40.0, and only 2 carried any provenance date - with every test and deployment green throughout. New [audit-doc-freshness.ps1](../scripts/audit-doc-freshness.ps1) applies the same shape as C1-C3 here to the whole user-facing set declared in [.doc-manifest.json](.doc-manifest.json): F1 version currency, F2 provenance age, F3 link integrity, F4 source coupling, F5 manifest integrity. **F5 is the one worth noting for anyone extending this pattern:** the first draft of the manifest carried four source prefixes that do not exist, and a prefix matching nothing makes the coupling check silently dead - green because it can never fire, the same failure shape as a script with no exit statement. A gate that validates other things must also validate its own inputs. Runs at pre-push (coupled), on PR + weekly via [docs-freshness.yml](../.github/workflows/docs-freshness.yml), and as Stage 1.12 here; weekly matters because a stamp ageing past its budget is not reachable from any code change. **This very entry was demanded by C1**, which blocked the push because the pipeline script changed |
| 2026-07-31 | **Stage 1.13 added: documentation must be TRUE, not merely fresh.** Stage 1.12 gates currency MARKERS - version header, provenance date, links - and none of that reads the prose, so a doc can pass every check while telling the reader something false. Measured on the same corpus that had just passed 1.12: [COMPLETE_API_REFERENCE.md](COMPLETE_API_REFERENCE.md) advertised a route-handler count of **86** across **20** controller files when the source had **117** across **31**, and 22 handlers were genuinely undocumented - the entire JWKS host allowlist API, the WIF resolve and assertion-debugger tools, credential rotate/reveal/activate, connection-info, and the per-endpoint OAuth token endpoint with its RFC 8414 metadata. The settings guide documented a control (`CustomResourceTypesEnabled`) that exists **nowhere in `api/src`**, which is the more dangerous direction of that bug: a missing setting means a reader cannot find something, a phantom one means they configure it and silently get nothing. And [REMOTE_DEBUGGING_AND_DIAGNOSIS.md](REMOTE_DEBUGGING_AND_DIAGNOSIS.md) offered the **retired** `scimserver2.yellowsmoke-af7a3fff...` estate as "Azure (live production)" in eight places - invisible to every link checker because a dead host inside a code fence is not a markdown link. New [audit-doc-content.mjs](../scripts/audit-doc-content.mjs) compares doc CLAIMS against source: route/controller/settings/preset counts, settings and reason-code coverage, phantom settings, API-reference route coverage, retired-infrastructure references, and json-block parseability. Its self-test carries **positive** controls as well as negative ones, because two first drafts were wrong in the false-positive direction (`acrscimserver20622` contains the retired string `scimserver2`; `**Version:** 4.1` is a document revision, not a product version). A twelfth check was built and deliberately discarded for an unacceptable false-positive rate - a gate that cries wolf gets switched off, taking the useful checks with it |
| 2026-07-31 (latest) | **Revision hygiene became a standing norm, after the canary was found holding more database connections than the database allows.** A routine look at proudbush showed **13 ACTIVE revisions, 12 of them serving 0% traffic**, the oldest from 2026-05-18. An active revision at 0% traffic is not free - it still runs a replica, and for this app that replica still holds a **5-connection Prisma pool**. That is **65 connections of demand against a `max_connections` of 50**. Nothing in the deploy path ever reclaimed them and no gate looked, because every signal a gate watches was healthy: the app responded, the tests were green, and the resource actually running out was the *database*, which no deployment check inspects. New [prune-revisions.ps1](../scripts/prune-revisions.ps1) keeps the newest 2 (serving + rollback target), never deactivates a revision serving traffic, and re-reads the revision list afterwards rather than trusting the exit code. Wired into [promote-to-prod.ps1](../scripts/promote-to-prod.ps1) after the blue/green flip and as Stage 6.2 of [dev-deployment-pipeline.ps1](../scripts/dev-deployment-pipeline.ps1), so it runs by construction rather than by memory. Proudbush pruned **13 -> 2**, verified non-disruptive: the serving revision's uptime was unchanged (never restarted) and all 24 endpoints intact. Also in this version: **a 401 from the SCIM data plane no longer destroys the admin UI session** - the client treated every 401 as an expired admin bearer, so disabling an endpoint's auth method, or any Workbench negative-auth probe, logged the operator out while the admin API was still returning 200 the whole time. Repo version `0.55.0` -> `0.55.1` |
| 2026-07-31 | **v0.55.0 promoted to dev and to the proudbush canary; both are off the EOL runtime.** Both had been serving **Node v25.9.0**, EOL since 2026-06-01 - roughly two months unpatched. Both now run **v24.18.1**. [Section 4 measured facts](#4-the-three-live-estates) and [G3](#14-gaps-risks-and-opportunities) updated; **calmsand is deliberately untouched** and still runs v25.9.0, because it lives in a different tenant and needs its own go-ahead. Validation actually run: live SCIM **1373/1373** on local standalone, **1372/1372** on Docker compose, **1373/1373** on dev, 1368/1373 on the canary; Playwright **197 pass / 0 fail** on dev and **191 pass / 0 fail** on the canary; Entra provisioning **45/45** across four presets. **New gap G3a** records why the canary's 5 live failures are pre-existing data state (a missing `login.windows.net` allowlist entry) rather than a regression, and why fixing it was left as a separate decision - adding a host widens a trust boundary on production and must not ride along inside a version promotion. Also: [docker-compose.ci-image.yml](../docker-compose.ci-image.yml)'s image tag became `${SCIM_CI_IMAGE:-...}` after its hardcoded pin was found to have gone stale at `0.54.0-alpha.12` - a stale pin silently tests the *wrong* artifact, which is worse than not testing at all. **The blue/green promotion was interrupted mid-flight and the design held**: green existed at 0% with blue pinned at 100%, traffic was never flipped, and recovery was to verify green on its `--green` label FQDN before flipping. Repo version `0.54.87` -> `0.55.0` |
| 2026-07-30 | **npm removed from the runtime image**, and a **container smoke test** added to [build-test.yml](../.github/workflows/build-test.yml). The Trivy gate had been red on **every branch for days** - including the three Dependabot PRs opened to fix it, and including a feature branch that was merged to master while red. Triage showed why nothing worked: **5 of the 7 findings, including the only CRITICAL, were npm's OWN bundled dependencies** (`tar`, `brace-expansion`, `undici`) under `/usr/local/lib/node_modules/npm`, not ours, and therefore unreachable from any `package.json`. The image path Trivy prints is the tell: `usr/local/lib/node_modules/npm/...` vs `app/node_modules/...`. Deleting a build-time tool the runtime never needed removes the attack surface outright. The entrypoint's `npx prisma migrate deploy` became a direct `node node_modules/prisma/build/index.js migrate deploy` - equivalent, since `npx prisma` already resolved to that exact file. **The smoke test is the important half:** the only post-build gate was a filesystem SCAN, which never starts the process, so stripping something the entrypoint needed would have made Trivy *greener* while shipping a container that cannot boot. "Fewer CVEs" must never be purchasable with "does not run." See [Section 7](#7-image-supply-chain) |
| 2026-07-30 (later) | Documented [docker-compose.ci-image.yml](../docker-compose.ci-image.yml) in [Section F3](#f3---docker-compose), the override that runs the Docker form factor from the CI-built image on a host where the npm registry is TLS-blocked and `docker build` therefore cannot run `npm ci`. **Demanded by the gate again, and by a different check this time:** C3 element coverage blocked the push with `infra element(s) exist but are never named in the doc: docker-compose.ci-image.yml`. This is the self-extending property working as intended - nobody edited the gate to know about this file; it started requiring documentation the moment the file appeared. Note the failure mode it guards against is not cosmetic: an undocumented compose override is exactly the kind of thing a future reader would delete as cruft, taking the only way to test the Docker form factor on a blocked host with it. Repo version at capture `0.54.86` -> `0.54.87` |
| 2026-07-29 | Wired both infra gates into the **pre-push hook** (Fast tier of [pre-push-checks.ps1](../scripts/pre-push-checks.ps1)) so they run on every push rather than on request. Fixed C1, which was structurally incapable of firing at pre-push: it compared the working tree against `HEAD`, but at pre-push the tree is clean and the change lives in the commits being pushed, so the hook now passes the upstream ref as `-BaseRef`. Switched both gates from `Get-ChildItem -Recurse` to `git ls-files` enumeration after the first wired run added ~47s to every push - the recurse was walking `node_modules` (22.7s vs 0.08s, and it surfaced 4 vendored Dockerfiles that are not ours). Gates now run in 0.78s and 1.02s. Added [test-audit-deployment-doc.ps1](../scripts/test-audit-deployment-doc.ps1), a committed self-test that proves C1/C2/C3 each fire on their own condition and refuses to run on a dirty tree |
| 2026-08-05 | Stage 5.3 of [dev-deployment-pipeline.ps1](../scripts/dev-deployment-pipeline.ps1) now sets `E2E_ALLOW_MUTATIONS=1` for the Playwright run against dev. That env var gates the endpoint create/delete wizard specs so they never execute against a customer-facing estate; dev is ours and every spec cleans up after itself, so leaving it unset meant the **primary endpoint-creation flow had no browser coverage at all** - two specs skipped on every pipeline run. No change to what is deployed or how; this only widens what the dev gate exercises. **This edit was demanded by check C1, not remembered by a human** - the second time the doc-currency gate has fired on a real change |
| 2026-07-29 | Made the document **enforced**. Added [Section 0.1 maintenance contract](#01-maintenance-contract---this-is-a-living-document), a machine-readable `**Last verified:**` header field, and the Stage 1.11 gate [audit-deployment-doc.ps1](../scripts/audit-deployment-doc.ps1) (C1 change coverage, C2 freshness, C3 element coverage, C4 live-estate truth). Extracted the Node LTS table to [node-lts.ps1](../scripts/node-lts.ps1) so the source-image and deployed-artifact checks share one definition. Closed the G3 and doc-rot gate gaps and partly closed G10/G11 in Section 14 |
| 2026-07-30 | Documented [rfc-currency.yml](../.github/workflows/rfc-currency.yml) in [Section F6](#f6---ci-ephemeral), which arrived when `origin/master` was merged into `feat/wif`, and explained why it and `trivyignore-review.yml` are scheduled rather than commit-triggered. **This edit was demanded by the gate, not remembered by a human:** check C1 blocked the push with `infra files changed but ... was not updated: .github/workflows/rfc-currency.yml`. First time the doc-currency gate fired on a real change, and it fired on a *merge* - the case most likely to slip past a person, because nobody feels like the author of a file that arrived via someone else's commit |
| 2026-07-29 | Initial version. All Azure facts captured live from the ProvIAM control plane and from the `/scim/admin/version` data plane on all three estates. Repo version `0.54.86`; dev serving `0.54.86`; both prods serving `0.54.0-alpha.11`. 14 findings recorded in Section 10 |
