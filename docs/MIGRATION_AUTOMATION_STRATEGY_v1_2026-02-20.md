# Migration Automation Strategy — PostgreSQL + In-Memory

> **Version**: 1.0 · **Date**: 2026-02-20
> **Companion docs**: `IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md` · `MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md` · `INMEMORY_ARCHITECTURE_AND_PLAN_v1_2026-02-20.md`
> **Scope**: How to automate the 12-phase migration for both PostgreSQL and In-Memory repository paths using AI-assisted development.

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current Codebase Inventory](#2-current-codebase-inventory)
3. [Automation Assessment by Phase](#3-automation-assessment-by-phase)
4. [What CAN Be Automated](#4-what-can-be-automated)
5. [What CANNOT Be Automated](#5-what-cannot-be-automated)
6. [AI-Assisted Workflow — How It Works](#6-ai-assisted-workflow--how-it-works)
7. [Phase-by-Phase Automation Breakdown](#7-phase-by-phase-automation-breakdown)
8. [Timeline Comparison — Manual vs Automated](#8-timeline-comparison--manual-vs-automated)
9. [Parallel Execution Strategy](#9-parallel-execution-strategy)
10. [Risk & Mitigation](#10-risk--mitigation)
11. [Tooling & Infrastructure Requirements](#11-tooling--infrastructure-requirements)
12. [Quality Gates & Verification](#12-quality-gates--verification)
13. [Appendix A — Current Prisma Call-Site Inventory](#13-appendix-a--current-prisma-call-site-inventory)
14. [Appendix B — Generated File Map](#14-appendix-b--generated-file-map)

---

## 1. Executive Summary

The 12-phase migration from the current SQLite/Prisma architecture to dual PostgreSQL + In-Memory repositories can be **~65% accelerated** through AI-assisted automation, reducing the total timeline from **~16 weeks (manual)** to **~5-6 weeks (automated)** for both paths running in parallel.

### Key Numbers

```
┌──────────────────────────────────────────────────────────────┐
│ Current Codebase                                              │
│   75 hand-written TypeScript files                            │
│   ~5,200 lines of core source code                            │
│   46 Prisma call sites across 4 service files                 │
│   666 unit + 184 E2E + 280 live tests                         │
│                                                               │
│ Migration Scope                                               │
│   ~3,280 LOC new code (PostgreSQL path)                       │
│   ~2,060 LOC new code (In-Memory path)                        │
│   ~1,800 LOC shared between both paths                        │
│   ~3,540 LOC total unique new code (both)                     │
│                                                               │
│ Automation Impact                                             │
│   ~80% of repository boilerplate → AI-generated               │
│   ~90% of in-memory implementations → AI-generated            │
│   ~60% of PATCH engine refactoring → AI-assisted              │
│   ~50% of test updates → AI-generated                         │
└──────────────────────────────────────────────────────────────┘
```

### Timeline at a Glance

```mermaid
gantt
    title Migration Timeline — Manual vs Automated (Both Paths)
    dateFormat  YYYY-MM-DD
    axisFormat  Week %W

    section Manual
    PostgreSQL Path       :manual_pg, 2026-03-02, 16w
    InMemory (after PG)   :manual_mem, after manual_pg, 10w

    section Automated (Parallel)
    P1 Repository Pattern :crit, auto_p1, 2026-03-02, 4d
    P2 Unified Model      :crit, auto_p2, after auto_p1, 3d
    PG Storage + Filters  :auto_pg, after auto_p2, 9d
    InMem Storage+Filters :auto_mem, after auto_p2, 2d
    P5 PATCH Engine       :crit, auto_p5, after auto_p1, 8d
    P6-P12 Features       :auto_rest, after auto_pg, 10d
    Integration Testing   :auto_test, after auto_rest, 5d
```

---

## 2. Current Codebase Inventory

### Files That Must Change

```mermaid
flowchart TB
    subgraph CORE_SERVICES["Core Services (must refactor)"]
        USERS["endpoint-scim-users.service.ts<br/>657 lines · 10 Prisma calls"]
        GROUPS["endpoint-scim-groups.service.ts<br/>765 lines · 10 Prisma calls"]
        FILTER["apply-scim-filter.ts<br/>157 lines · DB push-down logic"]
    end

    subgraph SUPPORT["Support Services (must refactor)"]
        ENDPOINT["endpoint.service.ts<br/>257 lines · 15 Prisma calls"]
        DATABASE["database.service.ts<br/>251 lines · 11 Prisma calls"]
    end

    subgraph INFRA["Infrastructure (must replace/extend)"]
        PRISMA_SVC["prisma.service.ts<br/>60 lines · SQLite-specific"]
        PRISMA_MOD["prisma.module.ts<br/>Module registration"]
    end

    subgraph UNCHANGED["Unchanged (shared layers)"]
        CONTROLLERS["6 Controllers"]
        GUARDS["Auth guards"]
        INTERCEPTORS["Interceptors"]
        PARSER["scim-filter-parser.ts<br/>544 lines"]
        PATCH_UTILS["scim-patch-path.ts<br/>Path utilities"]
        DTO["8 DTO files"]
    end

    style CORE_SERVICES fill:#ffcdd2,color:#333
    style SUPPORT fill:#ffe0b2,color:#333
    style INFRA fill:#fff9c4,color:#333
    style UNCHANGED fill:#c8e6c9,color:#333
```

### Prisma Call-Site Distribution

| File | `this.prisma.*` calls | Models Used | Complexity |
|------|:---------------------:|-------------|:----------:|
| `endpoint-scim-users.service.ts` | **10** | `scimUser` | Medium |
| `endpoint-scim-groups.service.ts` | **10** | `scimGroup`, `groupMember`, `$transaction` | High |
| `endpoint.service.ts` | **15** | `endpoint`, `scimUser`, `scimGroup`, `groupMember`, `requestLog` | Medium |
| `database.service.ts` | **11** | `scimUser`, `scimGroup`, `requestLog` | Low |
| **Total** | **46** | 5 models | — |

### Prisma Call Patterns (What AI Must Learn)

```mermaid
flowchart LR
    subgraph PATTERNS["46 Prisma Call Sites — 7 Patterns"]
        P1["create<br/>4 sites"]
        P2["findFirst<br/>14 sites"]
        P3["findMany<br/>6 sites"]
        P4["findUnique<br/>5 sites"]
        P5["update<br/>5 sites"]
        P6["delete / deleteMany<br/>4 sites"]
        P7["count<br/>6 sites"]
        P8["$transaction<br/>2 sites"]
    end

    P1 --> REPO["IResourceRepository.create()"]
    P2 --> REPO_FIND["IResourceRepository.findById()<br/>findByUserName()<br/>findByExternalId()"]
    P3 --> REPO_QUERY["IResourceRepository.query()"]
    P4 --> REPO_FIND
    P5 --> REPO_UPDATE["IResourceRepository.update()"]
    P6 --> REPO_DELETE["IResourceRepository.delete()"]
    P7 --> REPO_COUNT["IResourceRepository.count()"]
    P8 --> REPO_TX["IMembershipRepository<br/>.replaceMembers()"]

    style PATTERNS fill:#e3f2fd,color:#333
```

### PATCH Logic Size (Biggest Refactoring Challenge)

| Service | PATCH method | Lines | Operations Handled | Automatable? |
|---------|-------------|:-----:|:-------------------:|:------------:|
| **Users** | `applyPatchOperationsForEndpoint()` | **~180** | `add`, `replace`, `remove` on: `active`, `userName`, `externalId`, extension URNs, valuePath filters, dot-notation, no-path objects | 60% |
| **Groups** | `handleReplace()` + `handleAdd()` + `handleRemove()` | **~250** | `replace` (displayName, externalId, members), `add` (members with multi-flag), `remove` (members with filter/value/removeAll) | 65% |
| **Total PATCH logic** | — | **~430** | 15+ operation variants | ~62% |

---

## 3. Automation Assessment by Phase

### Automation Heatmap

```mermaid
flowchart TB
    subgraph HEATMAP["Automation Level by Phase"]
        direction LR
        P1["P1 Repository<br/>Pattern<br/>🟢 90%"]
        P2["P2 Unified<br/>Model<br/>🟢 85%"]
        P3_PG["P3 PostgreSQL<br/>Migration<br/>🟡 70%"]
        P3_MEM["P3M InMemory<br/>Impl<br/>🟢 95%"]
        P4_PG["P4 SQL Filter<br/>Push-Down<br/>🟡 75%"]
        P4_MEM["P4M InMemory<br/>Filter<br/>🟢 90%"]
        P5["P5 PATCH<br/>Engine<br/>🔴 60%"]
        P6["P6 Data-Driven<br/>Discovery<br/>🟡 70%"]
        P7["P7 ETag &<br/>Versioning<br/>🟢 85%"]
        P8["P8 Schema<br/>Validation<br/>🟡 70%"]
        P9["P9 Bulk<br/>Operations<br/>🟡 75%"]
        P10["P10 /Me<br/>Endpoint<br/>🟢 95%"]
        P11["P11 Per-Tenant<br/>Credentials<br/>🟢 85%"]
        P12["P12 Sort &<br/>Cleanup<br/>🟢 85%"]
    end

    style P1 fill:#c8e6c9,color:#333
    style P2 fill:#c8e6c9,color:#333
    style P3_PG fill:#fff9c4,color:#333
    style P3_MEM fill:#c8e6c9,color:#333
    style P4_PG fill:#fff9c4,color:#333
    style P4_MEM fill:#c8e6c9,color:#333
    style P5 fill:#ffcdd2,color:#333
    style P6 fill:#fff9c4,color:#333
    style P7 fill:#c8e6c9,color:#333
    style P8 fill:#fff9c4,color:#333
    style P9 fill:#fff9c4,color:#333
    style P10 fill:#c8e6c9,color:#333
    style P11 fill:#c8e6c9,color:#333
    style P12 fill:#c8e6c9,color:#333
```

**Legend**: 🟢 >80% automatable · 🟡 65-80% · 🔴 <65%

### Effort Breakdown: AI vs Human per Phase

| Phase | Total LOC | AI-Generated LOC | Human-Written LOC | AI % | Human Review Hours |
|-------|:---------:|:-----------------:|:-----------------:|:----:|:------------------:|
| P1 — Repository Pattern | ~300 | ~270 | ~30 | 90% | 2h |
| P2 — Unified Model | ~400 | ~340 | ~60 | 85% | 3h |
| P3 — PostgreSQL Impl | ~600 | ~420 | ~180 | 70% | 8h |
| P3M — InMemory Impl | ~250 | ~238 | ~12 | 95% | 1h |
| P4 — SQL Filters | ~300 | ~225 | ~75 | 75% | 4h |
| P4M — InMemory Filters | ~150 | ~135 | ~15 | 90% | 1h |
| P5 — PATCH Engine | ~400 | ~240 | ~160 | 60% | 12h |
| P6 — Discovery | ~200 | ~140 | ~60 | 70% | 4h |
| P7 — ETag | ~150 | ~128 | ~22 | 85% | 2h |
| P8 — Schema Validation | ~200 | ~140 | ~60 | 70% | 4h |
| P9 — Bulk Operations | ~250 | ~188 | ~62 | 75% | 4h |
| P10 — /Me Endpoint | ~80 | ~76 | ~4 | 95% | 0.5h |
| P11 — Credentials | ~200 | ~170 | ~30 | 85% | 2h |
| P12 — Sort & Cleanup | ~200 | ~170 | ~30 | 85% | 2h |
| **Totals** | **~3,680** | **~2,880** | **~800** | **78%** | **~49.5h** |

---

## 4. What CAN Be Automated

### Tier 1: Near-Full Automation (85-95%)

These are mechanical transformations where existing code provides a complete template:

```mermaid
flowchart TB
    subgraph TIER1["Tier 1 — Near-Full Automation (85-95%)"]
        T1A["Extract IResourceRepository<br/>interface from 46 Prisma calls"]
        T1B["Generate InMemoryResourceRepository<br/>Map-based CRUD: ~200 LOC"]
        T1C["Generate InMemoryStore singleton<br/>Map structures + indexes"]
        T1D["Generate PersistenceModule<br/>NestJS dynamic module wiring"]
        T1E["Generate /Me endpoint<br/>Thin route + principal mapping"]
        T1F["Refactor services to use<br/>repository DI injection"]
    end

    T1A -->|"Input: 46 call sites"| AI1["Copilot reads services<br/>→ generates interface"]
    T1B -->|"Input: IResourceRepository"| AI2["Copilot implements with<br/>Map.get/set/delete"]
    T1C -->|"Input: Prisma schema"| AI3["Copilot creates<br/>nested Maps + indexes"]
    T1D -->|"Input: interface list"| AI4["Copilot writes<br/>forRoot('driver')"]
    T1E -->|"Input: auth context"| AI5["Copilot wires<br/>req.user → service"]
    T1F -->|"Input: old services"| AI6["Copilot replaces<br/>this.prisma → this.repo"]

    style TIER1 fill:#c8e6c9,color:#333
```

**Example: Automating Interface Extraction**

```
AI INPUT:
  "Read api/src/modules/scim/services/endpoint-scim-users.service.ts
   and api/src/modules/scim/services/endpoint-scim-groups.service.ts.
   Find all this.prisma.* calls.
   Extract a unified IResourceRepository interface."

AI OUTPUT:
  ✓ Identifies 20 Prisma calls across User/Group services
  ✓ Maps: create → create(), findFirst → findById(), findMany → query(),
    update → update(), delete → delete(), findFirst (uniqueness) → assertUnique()
  ✓ Generates interface with correct TypeScript signatures
  ✓ Generates token string constants for NestJS DI
```

### Tier 2: Substantial Automation (65-80%)

AI generates the skeleton + 70% of logic, human fills in domain-specific decisions:

| Task | What AI Does | What Human Does |
|------|-------------|-----------------|
| **PostgreSQL schema** | Generates Prisma schema with CITEXT, JSONB, GIN comments | Reviews column types, index choices, JSONB path decisions |
| **SQL filter push-down** | Translates `tryPushToDb()` → full SQL builder with ILIKE/JSONB | Reviews case sensitivity semantics, validates pg_trgm setup |
| **Bulk operations** | Generates `BulkProcessor` with loop + error handling | Decides transaction vs undo-log semantics, failOnErrors threshold |
| **Schema validation** | Generates `SchemaValidator` with attribute type checking | Defines which attributes are required/readOnly/immutable per RFC |
| **Discovery endpoints** | Generates `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig` | Defines exact schema attribute metadata per RFC 7643 §8 |
| **Per-tenant credentials** | Generates storage + bcrypt compare | Reviews auth flow, token rotation, expiry handling |

### Tier 3: AI-Assisted (50-65%)

AI provides significant scaffolding but human must make critical design decisions:

| Task | AI Contribution | Human Contribution |
|------|----------------|-------------------|
| **PatchEngine extraction** | Extracts 430 LOC from 2 services into single class, identifies operation dispatch pattern | Reviews each SCIM PATCH operation variant for RFC compliance, handles edge cases (multi-valued add/remove, extension URN, valuePath filter) |
| **E2E test updates** | Updates import paths, generates test stubs for new repos | Validates behavior against SCIM spec, adds edge case tests |
| **Docker/Bicep updates** | Generates Dockerfile.memory, modifies docker-compose | Human validates runtime behavior, Azure deployment specifics |

---

## 5. What CANNOT Be Automated

### Hard Requirements for Human Judgment

```mermaid
flowchart TB
    subgraph HUMAN_REQUIRED["Human-Only Tasks"]
        direction TB
        H1["SCIM RFC 7643/7644<br/>Compliance Decisions"]
        H2["Migration Testing<br/>& Regression Validation"]
        H3["PostgreSQL Performance<br/>Tuning & Index Design"]
        H4["Deployment Pipeline<br/>& Rollout Strategy"]
        H5["Transaction Semantics<br/>Design for In-Memory"]
        H6["Security Review<br/>& Credential Handling"]
    end

    H1 -.->|"Example"| H1E["multi-valued attribute<br/>replace semantics: merge or overwrite?<br/>RFC 7644 §3.5.2.1 vs §3.5.2.2"]
    H2 -.->|"Example"| H2E["Run 666 + 184 + 280 tests<br/>Fix regressions<br/>Verify Entra ID compatibility"]
    H3 -.->|"Example"| H3E["GIN vs btree_gist for co/sw?<br/>pg_trgm trigram size tuning<br/>JSONB path vs flat column trade-off"]
    H4 -.->|"Example"| H4E["Blue-green vs rolling update?<br/>GitHub Actions workflow changes<br/>Azure Container App revision mgmt"]
    H5 -.->|"Example"| H5E["Bulk PATCH: undo-log depth?<br/>Snapshot before or after?<br/>Concurrent bulk handling?"]
    H6 -.->|"Example"| H6E["bcrypt rounds? Token expiry?<br/>Key rotation mechanism?<br/>Audit trail requirements?"]

    style HUMAN_REQUIRED fill:#ffcdd2,color:#333
```

### Why PATCH Engine Is the Automation Bottleneck

The PATCH logic (430 LOC across 2 services) is the **least automatable** because:

```typescript
// Example: This single operation handler has 15+ code paths
// that require RFC knowledge to restructure correctly

// Groups PATCH: handleAdd() must handle:
// 1. path="members" + Array value → add multiple members
// 2. path="members" + Object value → add single member
// 3. no path + Object with "members" key → indirect add
// 4. multi-member flag disabled → reject if >1 member
// 5. duplicate members → deduplicate silently
// 6. non-existent member reference → resolve via user lookup

// Users PATCH: applyPatchOperationsForEndpoint() must handle:
// 1. path="active" → boolean extraction (string/boolean/object)
// 2. path="userName" → string + case-insensitive uniqueness check
// 3. path="externalId" → nullable string
// 4. path="urn:...:2.0:User:manager" → extension URN parsing
// 5. path='emails[type eq "work"].value' → valuePath filter
// 6. path="name.givenName" → dot-notation nested update
// 7. no path + object value → normalize keys + extract DB fields
// 8. remove + extension path → remove from extension namespace
// 9. remove + valuePath → remove matching array element
// 10. remove + dot-notation → remove nested field
```

**AI can extract these into a PatchEngine class**, but a human must verify that each of the 15+ operation variants produces RFC-correct results — especially when operations interact (e.g., `add` then `remove` on same attribute in one PATCH request).

---

## 6. AI-Assisted Workflow — How It Works

### Session-Based Development with Copilot Agent

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant AI as Copilot Agent
    participant CODE as Codebase
    participant TEST as Test Suite

    rect rgb(230, 245, 255)
        Note over DEV,TEST: Phase 1 — Repository Pattern (~1 day)
        DEV->>AI: "Read users.service.ts and groups.service.ts.<br/>Extract all Prisma calls into IResourceRepository."
        AI->>CODE: read_file × 2 (1,422 LOC)
        AI->>CODE: grep 'this.prisma.' (46 matches)
        AI->>AI: Analyze call patterns → 7 method signatures
        AI->>CODE: create_file: IResourceRepository interface (~60 LOC)
        AI-->>DEV: "Generated interface with 8 methods"
    end

    rect rgb(255, 245, 230)
        Note over DEV,TEST: Generate Both Implementations
        DEV->>AI: "Implement InMemoryResourceRepository<br/>using Map<string, Map> stores."
        AI->>CODE: create_file: InMemoryResourceRepository (~200 LOC)
        AI->>CODE: create_file: InMemoryStore (~80 LOC)

        DEV->>AI: "Implement PrismaResourceRepository<br/>by wrapping existing Prisma calls."
        AI->>CODE: create_file: PrismaResourceRepository (~300 LOC)
        AI-->>DEV: "Both implementations generated"
    end

    rect rgb(230, 255, 230)
        Note over DEV,TEST: Refactor Services
        DEV->>AI: "Replace all this.prisma.scimUser.* calls<br/>in users.service.ts with this.repo.* calls."
        AI->>CODE: replace_string × 10 (users service)
        AI->>CODE: replace_string × 10 (groups service)
        AI->>CODE: create_file: PersistenceModule (dynamic)
        AI-->>DEV: "Services refactored to use repository DI"
    end

    rect rgb(255, 230, 230)
        Note over DEV,TEST: Human Verification
        DEV->>TEST: npm test (666 unit tests)
        TEST-->>DEV: ❌ 12 failures (type mismatches)
        DEV->>AI: "Fix these 12 test failures: [errors]"
        AI->>CODE: Fix type mismatches + import paths
        DEV->>TEST: npm test
        TEST-->>DEV: ✅ 666 pass
        DEV->>TEST: npm run test:e2e (184 E2E)
        TEST-->>DEV: ✅ 184 pass
    end
```

### Prompt Templates for Each Phase

#### Phase 1 — Repository Extraction Prompt

```
Read these files:
- api/src/modules/scim/services/endpoint-scim-users.service.ts
- api/src/modules/scim/services/endpoint-scim-groups.service.ts
- api/src/modules/scim/filters/apply-scim-filter.ts

Find every `this.prisma.<model>.<method>()` call.
Group them by operation type (create, find, update, delete, count).
Generate a TypeScript interface `IResourceRepository` with:
- Async methods for each operation pattern
- Input/output types using existing DTOs where possible
- JSDoc comments referencing SCIM RFC sections

Then generate BOTH:
1. PrismaResourceRepository (wraps existing Prisma calls)
2. InMemoryResourceRepository (uses Map<string, Map<string, Model>>)
3. PersistenceModule.forRoot(driver) dynamic NestJS module
```

#### Phase 5 — PATCH Engine Extraction Prompt

```
Read these methods:
- endpoint-scim-users.service.ts → applyPatchOperationsForEndpoint() (~180 LOC)
- endpoint-scim-groups.service.ts → handleReplace/handleAdd/handleRemove() (~250 LOC)
- scim-patch-path.ts (all utility functions)

Extract ALL patch logic into a single PatchEngine class:
- Input: current resource payload + PatchOperations array + config flags
- Output: updated payload object (no Prisma types)
- Must handle all 15+ operation paths (extension URN, valuePath, dot-notation, etc.)
- Must be persistence-agnostic (no Prisma imports)
- Include unit tests covering each operation variant

IMPORTANT: Preserve the exact behavior of every operation path.
Do NOT simplify or optimize the RFC compliance logic.
```

---

## 7. Phase-by-Phase Automation Breakdown

### Phase 1 — Repository Pattern (🟢 90% Automatable)

```mermaid
flowchart LR
    subgraph INPUT["AI Reads (Input)"]
        I1["users.service.ts<br/>657 LOC · 10 Prisma calls"]
        I2["groups.service.ts<br/>765 LOC · 10 Prisma calls"]
        I3["endpoint.service.ts<br/>257 LOC · 15 Prisma calls"]
        I4["apply-scim-filter.ts<br/>157 LOC"]
    end

    subgraph AI_WORK["AI Generates"]
        A1["IResourceRepository<br/>~60 LOC interface"]
        A2["IMembershipRepository<br/>~30 LOC interface"]
        A3["IEndpointRepository<br/>~40 LOC interface"]
        A4["PrismaResourceRepository<br/>~300 LOC"]
        A5["InMemoryResourceRepository<br/>~200 LOC"]
        A6["InMemoryStore<br/>~80 LOC"]
        A7["PersistenceModule<br/>~40 LOC"]
    end

    subgraph HUMAN["Human Reviews"]
        H1["Type signatures<br/>Edge cases<br/>Test failures"]
    end

    INPUT --> AI_WORK --> HUMAN

    style INPUT fill:#e3f2fd,color:#333
    style AI_WORK fill:#c8e6c9,color:#333
    style HUMAN fill:#fff9c4,color:#333
```

| Step | Actor | LOC | Time |
|------|-------|:---:|------|
| Read 4 service files, identify 46 Prisma call sites | AI | 0 | 2 min |
| Generate `IResourceRepository` + `IMembershipRepository` | AI | ~90 | 5 min |
| Generate `PrismaResourceRepository` (wrap existing calls) | AI | ~300 | 10 min |
| Generate `InMemoryResourceRepository` + `InMemoryStore` | AI | ~280 | 10 min |
| Generate `PersistenceModule.forRoot()` | AI | ~40 | 3 min |
| Refactor `users.service.ts` → inject `IResourceRepository` | AI | ~40 changed | 10 min |
| Refactor `groups.service.ts` → inject `IResourceRepository` | AI | ~40 changed | 10 min |
| Review generated code, fix type edge cases | **Human** | ~30 fixes | **2h** |
| Run test suite, fix failures | **Human** + AI | variable | **1h** |
| **Total** | | **~750** | **~4h** |

### Phase 3 — PostgreSQL Migration (🟡 70% Automatable)

| Step | Actor | What | Time |
|------|-------|------|------|
| Generate unified `scim_resource` Prisma schema | AI | CITEXT columns, JSONB payload, version INT, partial unique indexes | 15 min |
| Generate Prisma migration SQL | AI (Prisma CLI) | `npx prisma migrate dev --name unified-resource` | 2 min |
| Generate data migration script (Users+Groups → scim_resource) | AI | SQL INSERT...SELECT with JSON wrapping | 20 min |
| Update Docker Compose for PostgreSQL | AI | `services: postgres:` + health check | 5 min |
| Update docker-entrypoint.sh | AI | `prisma migrate deploy` before start | 5 min |
| Generate Bicep for Azure Flexible Server | AI | `postgresql.bicep` module | 15 min |
| Review & test migration path | **Human** | Run with real data, verify JSONB correctness, test rollback | **6h** |
| Performance validation with indexes | **Human** | Create test data, verify GIN queries, tune if needed | **2h** |
| **Total** | | | **~1 week** |

### Phase 3M — In-Memory Implementation (🟢 95% Automatable)

| Step | Actor | What | Time |
|------|-------|------|------|
| Generate `InMemoryStore` with all Maps + secondary indexes | AI | Resources, userName/externalId indexes, members, tenants | 10 min |
| Generate all 5 In-Memory repository implementations | AI | Resource, Membership, Tenant, Schema, Credential repos | 30 min |
| Generate snapshot service (optional) | AI | serialize/deserialize Maps ↔ JSON | 15 min |
| Wire into PersistenceModule | AI | Already done in P1 | 0 |
| Review + quick test | **Human** | Sanity check, run unit tests with in-memory | **1h** |
| **Total** | | **~250 LOC** | **~2h** |

### Phase 5 — PATCH Engine (🔴 60% Automatable)

```mermaid
flowchart TB
    subgraph CURRENT["Current: PATCH Logic Spread Across 2 Services"]
        U_PATCH["users.service.ts<br/>applyPatchOperationsForEndpoint()<br/>~180 LOC"]
        G_REPLACE["groups.service.ts<br/>handleReplace() ~80 LOC"]
        G_ADD["groups.service.ts<br/>handleAdd() ~40 LOC"]
        G_REMOVE["groups.service.ts<br/>handleRemove() ~60 LOC"]
        UTILS["scim-patch-path.ts<br/>isValuePath, parseValuePath,<br/>applyValuePathUpdate, etc."]
    end

    subgraph TARGET["Target: Pure Domain PatchEngine"]
        ENGINE["PatchEngine<br/>~400 LOC<br/>apply(resource, operations, config)<br/>→ updatedPayload"]
        ENGINE_TEST["patch-engine.spec.ts<br/>~80 test cases"]
    end

    CURRENT -->|"AI extracts +<br/>Human validates"| TARGET

    style CURRENT fill:#ffcdd2,color:#333
    style TARGET fill:#c8e6c9,color:#333
```

| Step | Actor | What | Time |
|------|-------|------|------|
| Extract PATCH methods into standalone class | AI | Move 430 LOC, remove Prisma dependencies | 30 min |
| Generate unified dispatch (Users + Groups) | AI | Merge user/group operation handling | 20 min |
| Remove Prisma types from PATCH logic | AI | Replace `Prisma.ScimUserUpdateInput` with domain types | 15 min |
| Generate 80 test cases from existing behavior | AI | One test per operation variant × resource type | 1h |
| **Review every operation path for RFC compliance** | **Human** | Verify 15+ variants match RFC 7644 §3.5.2 | **6h** |
| Fix edge cases found during review | Human + AI | Multi-valued attribute semantics, extension URN resolution | **4h** |
| Regression test against Entra ID connector | **Human** | Manual provisioning test with real Entra | **2h** |
| **Total** | | **~400 LOC + ~80 tests** | **~1.5 weeks** |

### Phases 6-12 — Feature Phases (🟢🟡 70-95% Automatable)

```mermaid
flowchart LR
    subgraph BATCH1["Can Run in Parallel"]
        P6["P6 Discovery<br/>🟡 70%<br/>~3 days"]
        P7["P7 ETag<br/>🟢 85%<br/>~2 days"]
        P10["P10 /Me<br/>🟢 95%<br/>~0.5 days"]
    end

    subgraph BATCH2["After P6"]
        P8["P8 Schema Validation<br/>🟡 70%<br/>~3 days"]
        P11["P11 Credentials<br/>🟢 85%<br/>~2 days"]
    end

    subgraph BATCH3["After P5"]
        P9["P9 Bulk Ops<br/>🟡 75%<br/>~3 days"]
        P12["P12 Sort/Cleanup<br/>🟢 85%<br/>~2 days"]
    end

    BATCH1 --> BATCH2
    BATCH1 --> BATCH3

    style BATCH1 fill:#c8e6c9,color:#333
    style BATCH2 fill:#fff9c4,color:#333
    style BATCH3 fill:#fff9c4,color:#333
```

| Phase | AI Task | Human Task | Total |
|-------|---------|-----------|-------|
| P6 Discovery | Generate `/Schemas`, `/ResourceTypes`, `/ServiceProviderConfig` from RFC templates + storage repos | Define attribute metadata, validate against SCIM spec | 3 days |
| P7 ETag | Wire `version` increment into repository `.update()`, add `If-Match`/`If-None-Match` to interceptor | Verify 304/412 behavior, test concurrent write scenarios | 2 days |
| P8 Schema Validation | Generate `SchemaValidator` with attribute type/required/mutability checks | Define SCIM User/Group attribute schemas per RFC 7643 §8 | 3 days |
| P9 Bulk Operations | Generate `BulkProcessor` with sequential execution + error collection | Decide transaction semantics (PG: true tx, InMem: undo log) | 3 days |
| P10 /Me | Generate route alias `/Me` → current user's resource | Verify auth principal extraction | 0.5 days |
| P11 Credentials | Generate credential storage (both repos) + bcrypt comparison | Review auth flow, test token formats | 2 days |
| P12 Sort & Cleanup | Generate `sortBy`/`sortOrder` query parameter handling + `Array.sort()` / `ORDER BY` | RFC compliance check, remove deprecated code | 2 days |

---

## 8. Timeline Comparison — Manual vs Automated

### Single Developer — Sequential

```mermaid
gantt
    title Single Developer — Manual vs Automated
    dateFormat  YYYY-MM-DD
    axisFormat  Week %W

    section Manual — PG Only (16 weeks)
    P1 Repository     :m1, 2026-03-02, 2w
    P2 Unified Model  :m2, after m1, 2w
    P3 PostgreSQL     :m3, after m2, 2w
    P4 SQL Filters    :m4, after m3, 2w
    P5 PATCH Engine   :m5, after m1, 3w
    P6 Discovery      :m6, after m3, 2w
    P7 ETag           :m7, after m3, 2w
    P8 Schema Valid   :m8, after m6, 2w
    P9 Bulk           :m9, after m5, 2w
    P10 /Me           :m10, after m1, 1w
    P11 Credentials   :m11, after m3, 2w
    P12 Sort          :m12, after m4, 2w

    section Automated — Both Paths (5-6 weeks)
    P1 Repository     :crit, a1, 2026-03-02, 4d
    P2 Unified Model  :crit, a2, after a1, 3d
    P3+P3M Storage    :a3, after a2, 5d
    P4+P4M Filters    :a4, after a3, 4d
    P5 PATCH Engine   :crit, a5, after a1, 8d
    P6-P12 Features   :a6, after a4, 10d
    Integration Test  :a7, after a6, 5d
```

### Summary Table

| Scenario | Manual | Automated | Speedup |
|----------|:------:|:---------:|:-------:|
| PostgreSQL only (1 dev) | 16 weeks | 4-5 weeks | **3.5x** |
| In-Memory only (1 dev) | 10 weeks | 3-4 weeks | **2.8x** |
| Both parallel (1 dev) | 16 weeks | 5-6 weeks | **2.9x** |
| Both sequential (1 dev) | 26 weeks | 7-8 weeks | **3.5x** |
| Both parallel (2 devs, manual) | 16 weeks | — | — |
| Both parallel (2 devs, automated) | — | 4-5 weeks | **3.5x** |

### Where Time Is Saved

```mermaid
pie title Time Allocation — Automated Both Paths (5-6 weeks)
    "AI Code Generation" : 20
    "Human Review & Refinement" : 25
    "PATCH Engine (partially manual)" : 25
    "Testing & Integration" : 20
    "Deployment & Docker" : 10
```

### Where Time Is NOT Saved

| Activity | Manual Time | Automated Time | Saved? |
|----------|:-----------:|:--------------:|:------:|
| PATCH Engine RFC review | 1.5 weeks | 1-1.5 weeks | ❌ Minimal |
| Running 1,130 tests + fixing regressions | 2 weeks | 1 week | ⚠️ Partial |
| PostgreSQL performance tuning | 1 week | 0.5-1 week | ⚠️ Partial |
| Docker/Azure deployment testing | 1 week | 0.5 week | ⚠️ Partial |
| SCIM RFC compliance edge cases | 1 week | 1 week | ❌ None |

---

## 9. Parallel Execution Strategy

### Two-Developer Parallel Plan

```mermaid
flowchart TB
    subgraph SHARED["Week 1-2: Both Devs (shared)"]
        P1["P1 Repository Pattern<br/>Dev A leads, Dev B reviews"]
    end

    subgraph FORK["Week 2+: Fork"]
        direction LR
        subgraph DEV_A["Dev A: PostgreSQL Track"]
            DA1["P2 Unified Model + Schema"]
            DA2["P3 PostgreSQL Migration"]
            DA3["P4 SQL Filter Push-Down"]
            DA4["P6 Discovery (PG storage)"]
            DA5["P7 ETag (PG version col)"]
            DA6["P11 Credentials (PG table)"]
            DA7["Deployment: Docker, Bicep"]
        end

        subgraph DEV_B["Dev B: In-Memory + Shared Domain"]
            DB1["P3M InMemory Impl"]
            DB2["P4M InMemory Filters"]
            DB3["P5 PATCH Engine"]
            DB4["P8 Schema Validation"]
            DB5["P9 Bulk Operations"]
            DB6["P10 /Me Endpoint"]
            DB7["P12 Sort & Cleanup"]
        end
    end

    subgraph MERGE["Final Week: Integration"]
        MERGE1["Cross-test: PG tests with InMem, InMem tests with PG"]
        MERGE2["Full regression: 666 + 184 + 280 tests × both drivers"]
        MERGE3["Docker build + live test both images"]
    end

    SHARED --> FORK --> MERGE

    style SHARED fill:#e3f2fd,color:#333
    style DEV_A fill:#e8f5e9,color:#333
    style DEV_B fill:#fff3e0,color:#333
    style MERGE fill:#f3e5f5,color:#333
```

### Two-Developer Timeline (Automated)

```
Developer A (PostgreSQL Track):
Week 1:  P1 (shared, lead) ────────────────────── 4 days
Week 2:  P2 (model + PG schema) ──────────────── 3 days
         P3 (PostgreSQL migration) ──────────── 5 days
Week 3:  P4 (SQL filters) ────────────────────── 4 days
         P6 (Discovery, PG storage) ──────────── 3 days
Week 4:  P7+P11 (ETag + Credentials, PG) ────── 4 days
         Docker + Bicep + Deployment ──────────── 2 days

Developer B (InMemory + Domain Track):
Week 1:  P1 review ───────────────────────────── 0.5 days
         P3M (InMemory impl) ──────────────────── 0.5 days
         P4M (InMemory filters) ──────────────── 1 day
         P5 (PATCH Engine extraction) ─────────── starts
Week 2:  P5 (PATCH Engine continued) ──────────── 4 days
         P8 (Schema Validation) ──────────────── 3 days
Week 3:  P9 (Bulk Operations) ────────────────── 3 days
         P10 (/Me Endpoint) ──────────────────── 0.5 days
         P12 (Sort & Cleanup) ────────────────── 2 days
Week 4:  P6 (Discovery, InMem storage) ────────── 2 days

Both Devs (Week 5):
         Cross-driver testing ─────────────────── 2 days
         Full regression + Docker builds ──────── 3 days

TOTAL: ~4-5 weeks with 2 developers (automated)
```

### Conflict-Free Ownership

| File/Module | Dev A (PostgreSQL) | Dev B (InMemory + Domain) |
|-------------|:-:|:-:|
| `PrismaResourceRepository` | ✅ | — |
| `InMemoryResourceRepository` | — | ✅ |
| `InMemoryStore` | — | ✅ |
| `PatchEngine` | — | ✅ |
| `SchemaValidator` | — | ✅ |
| `BulkProcessor` | — | ✅ |
| `PersistenceModule` | ✅ (PG providers) | ✅ (InMem providers) |
| `FilterPlanner` (SQL) | ✅ | — |
| `evaluateFilter()` (JS) | — | ✅ |
| Prisma schema / migrations | ✅ | — |
| Dockerfile / Bicep | ✅ | — |
| Dockerfile.memory | — | ✅ |
| Service files (users/groups) | ✅ (repo injection) | ✅ (PATCH extraction) |

> **⚠️ Single conflict point**: Service files are modified by both tracks. Solution: Dev A completes repository injection in Week 1 (P1), Dev B starts PATCH extraction only after P1 merges.

---

## 10. Risk & Mitigation

### Risk Matrix

```mermaid
quadrantChart
    title Risk Assessment — Automated Migration
    x-axis Low Impact --> High Impact
    y-axis Low Probability --> High Probability

    AI generates incorrect PATCH logic: [0.7, 0.6]
    AI misses Prisma edge case: [0.4, 0.5]
    Test suite doesn't catch regression: [0.8, 0.3]
    PostgreSQL migration data loss: [0.9, 0.2]
    AI-generated code fails in Docker: [0.3, 0.4]
    Merge conflicts between tracks: [0.5, 0.5]
    SCIM Validator tests fail: [0.6, 0.4]
    Performance regression: [0.6, 0.3]
```

### Mitigation Strategies

| Risk | Probability | Impact | Mitigation |
|------|:-----------:|:------:|------------|
| **AI generates incorrect PATCH logic** | High | High | Run all 280 live tests after each change; compare SCIM Validator results before/after |
| **AI misses Prisma type edge case** | Medium | Medium | TypeScript strict mode catches at compile time; 666 unit tests catch at runtime |
| **Merge conflicts between dev tracks** | Medium | Medium | P1 must merge before either track starts; use feature branches per phase |
| **PostgreSQL migration data loss** | Low | Critical | Backup SQLite DB before migration; dual-write mode for 1 sprint; count verification |
| **SCIM Validator tests fail after refactor** | Medium | High | Run Microsoft SCIM Validator (25 tests) as quality gate after each phase |
| **Performance regression** | Low | Medium | Benchmark filter queries at 10K resources; compare before/after response times |

### Quality Gate Checkpoints

```mermaid
flowchart LR
    P1_DONE["P1 Complete"] -->|"666 unit ✅<br/>184 E2E ✅"| P2_START["Start P2"]
    P2_DONE["P2 Complete"] -->|"All tests pass<br/>both drivers"| FORK["Fork Tracks"]
    FORK --> PG_GATE["PG Track Gates"]
    FORK --> MEM_GATE["InMem Track Gates"]

    PG_GATE --> PG_P3["P3: migrate real data<br/>compare record counts"]
    PG_P3 --> PG_P4["P4: filter benchmarks<br/>pg_trgm validation"]
    PG_P4 --> PG_FINAL["PG: full regression<br/>+ SCIM Validator"]

    MEM_GATE --> MEM_P5["P5: all PATCH variants<br/>manual RFC review"]
    MEM_P5 --> MEM_P9["P9: bulk edge cases<br/>partial failure handling"]
    MEM_P9 --> MEM_FINAL["InMem: full regression<br/>+ SCIM Validator"]

    PG_FINAL --> MERGE_GATE["Integration Gate:<br/>1,130 tests × 2 drivers<br/>Docker builds × 2<br/>SCIM Validator × 2"]
    MEM_FINAL --> MERGE_GATE

    style MERGE_GATE fill:#f3e5f5,color:#333
```

---

## 11. Tooling & Infrastructure Requirements

### Development Environment

| Tool | Purpose | Required For |
|------|---------|:------------:|
| **VS Code + GitHub Copilot (Agent mode)** | AI code generation, multi-file refactoring | All phases |
| **Node.js 24** | Runtime | All |
| **TypeScript 5.9** | Type checking | All |
| **Prisma 7 CLI** | Schema migration (PostgreSQL path) | P2, P3 |
| **Docker Desktop** | Container builds + PostgreSQL for testing | P3, Deployment |
| **PostgreSQL 17** (local or Docker) | Target database for PG path | P3, P4 |
| **k6** (optional) | Load testing, performance benchmarks | P4, P12 |
| **Microsoft SCIM Validator** | Compliance verification | All phases (quality gate) |

### CI Pipeline Changes

```yaml
# .github/workflows/build-test.yml — Updated for dual drivers

jobs:
  test-inmemory:
    runs-on: ubuntu-latest
    env:
      DB_DRIVER: memory
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npm test          # 666 unit tests
      - run: npm run test:e2e  # 184 E2E tests (in-memory)

  test-postgresql:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:17-alpine
        env:
          POSTGRES_DB: scimserver_test
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    env:
      DB_DRIVER: postgresql
      DATABASE_URL: postgresql://test:test@localhost:5432/scimserver_test
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: npm ci
      - run: npx prisma migrate deploy
      - run: npm test
      - run: npm run test:e2e  # 184 E2E tests (PostgreSQL)
```

---

## 12. Quality Gates & Verification

### Test Matrix — Both Drivers

| Test Suite | In-Memory | PostgreSQL | What It Catches |
|-----------|:---------:|:----------:|-----------------|
| Unit (666 tests) | ✅ default | ✅ optional | Domain logic correctness |
| E2E (184 tests) | ✅ CI default | ✅ pre-deploy | API contract, HTTP behavior |
| Live (280 tests) | ✅ | ✅ | Full SCIM protocol compliance |
| SCIM Validator (25 tests) | ✅ | ✅ | Microsoft Entra compatibility |
| Load (k6) | ⚠️ scaling limits | ✅ | Performance under load |

### Verification Workflow Per Phase

```mermaid
flowchart TD
    START["Phase Complete"] --> BUILD["npm run build<br/>✅ No compile errors"]
    BUILD --> UNIT["npm test<br/>✅ 666 unit tests pass"]
    UNIT --> E2E_MEM["DB_DRIVER=memory npm run test:e2e<br/>✅ 184 E2E pass"]
    E2E_MEM --> E2E_PG["DB_DRIVER=postgresql npm run test:e2e<br/>✅ 184 E2E pass"]
    E2E_PG --> DOCKER["docker build + run<br/>✅ Starts, responds to /health"]
    DOCKER --> LIVE["scripts/live-test.ps1<br/>✅ 280 live tests pass"]
    LIVE --> SCIM_VAL["Microsoft SCIM Validator<br/>✅ 25 tests pass"]
    SCIM_VAL --> APPROVE["✅ Phase Approved<br/>Merge to main"]

    style START fill:#e3f2fd,color:#333
    style APPROVE fill:#c8e6c9,color:#333
```

---

## 13. Appendix A — Current Prisma Call-Site Inventory

### endpoint-scim-users.service.ts (10 calls)

| Line | Prisma Call | Maps To Repository Method |
|:----:|------------|---------------------------|
| 81 | `this.prisma.scimUser.create({ data })` | `IResourceRepository.create()` |
| 89 | `this.prisma.scimUser.findFirst({ where: { scimId, endpointId } })` | `IResourceRepository.findById()` |
| 132 | `this.prisma.scimUser.findMany({ where, orderBy })` | `IResourceRepository.query()` |
| 174 | `this.prisma.scimUser.findFirst({ where: { scimId, endpointId } })` | `IResourceRepository.findById()` |
| 187 | `this.prisma.scimUser.update({ where: { id }, data })` | `IResourceRepository.update()` |
| 206 | `this.prisma.scimUser.findFirst({ where: { scimId, endpointId } })` | `IResourceRepository.findById()` |
| 235 | `this.prisma.scimUser.update({ where: { id }, data })` | `IResourceRepository.update()` |
| 245 | `this.prisma.scimUser.findFirst({ where: { scimId, endpointId } })` | `IResourceRepository.findById()` |
| 257 | `this.prisma.scimUser.delete({ where: { id } })` | `IResourceRepository.delete()` |
| 298 | `this.prisma.scimUser.findFirst({ where, select })` | `IResourceRepository.assertUnique()` |

### endpoint-scim-groups.service.ts (10 calls)

| Line | Prisma Call | Maps To Repository Method |
|:----:|------------|---------------------------|
| 80 | `this.prisma.scimGroup.create({ data })` | `IResourceRepository.create()` |
| 145 | `this.prisma.scimGroup.findMany({ where, include: members })` | `IResourceRepository.query()` + `IMembershipRepository.getMembers()` |
| 232 | `this.prisma.$transaction(async (tx) => { ... })` | `IMembershipRepository.replaceMembers()` |
| 299 | `this.prisma.$transaction(async (tx) => { ... })` | `IMembershipRepository.replaceMembers()` |
| 340 | `this.prisma.scimGroup.findFirst({ where })` | `IResourceRepository.findById()` |
| 352 | `this.prisma.scimGroup.delete({ where })` | `IResourceRepository.delete()` |
| 377 | `this.prisma.scimGroup.findFirst({ where, select })` | `IResourceRepository.assertUnique()` |
| 405 | `this.prisma.scimGroup.findFirst({ where })` | `IResourceRepository.assertUnique()` |
| 427 | `this.prisma.scimGroup.findFirst({ where, select, include })` | `IResourceRepository.findById()` + `IMembershipRepository.getMembers()` |
| 637 | `this.prisma.groupMember.createMany({ data })` | `IMembershipRepository.addMembers()` |

### endpoint.service.ts (15 calls)

| Line | Prisma Call | Maps To |
|:----:|------------|---------|
| 38 | `this.prisma.endpoint.findMany()` | `IEndpointRepository.listAll()` |
| 84 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findByName()` |
| 92 | `this.prisma.endpoint.create()` | `IEndpointRepository.create()` |
| 109 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findById()` |
| 121 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findById()` |
| 138 | `this.prisma.endpoint.findMany()` | `IEndpointRepository.findByName()` |
| 147 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findById()` |
| 162 | `this.prisma.endpoint.update()` | `IEndpointRepository.update()` |
| 181 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findById()` |
| 190 | `this.prisma.endpoint.delete()` | `IEndpointRepository.delete()` |
| 204 | `this.prisma.endpoint.findUnique()` | `IEndpointRepository.findById()` |
| 213 | `this.prisma.scimUser.count()` | `IResourceRepository.count()` |
| 214 | `this.prisma.scimGroup.count()` | `IResourceRepository.count()` |
| 215 | `this.prisma.groupMember.count()` | `IMembershipRepository.count()` |
| 218 | `this.prisma.requestLog.count()` | `ILogRepository.count()` |

### database.service.ts (11 calls)

| Line | Prisma Call | Maps To |
|:----:|------------|---------|
| 41 | `this.prisma.scimUser.findMany()` | `IResourceRepository.query()` |
| 67 | `this.prisma.scimUser.count()` | `IResourceRepository.count()` |
| 112 | `this.prisma.scimGroup.findMany()` | `IResourceRepository.query()` |
| 130 | `this.prisma.scimGroup.count()` | `IResourceRepository.count()` |
| 161 | `this.prisma.scimUser.findUnique()` | `IResourceRepository.findById()` |
| 188 | `this.prisma.scimGroup.findUnique()` | `IResourceRepository.findById()` |
| 223 | `this.prisma.scimUser.count()` | `IResourceRepository.count()` |
| 224 | `this.prisma.scimUser.count({ where })` | `IResourceRepository.count()` |
| 225 | `this.prisma.scimGroup.count()` | `IResourceRepository.count()` |
| 226 | `this.prisma.requestLog.count()` | `ILogRepository.count()` |
| 227 | `this.prisma.requestLog.count({ where })` | `ILogRepository.count()` |

---

## 14. Appendix B — Generated File Map

### New Files Created by Phase

```mermaid
flowchart TB
    subgraph P1_FILES["Phase 1 — Repository Pattern"]
        F1["src/domain/interfaces/<br/>├── i-resource-repository.ts<br/>├── i-membership-repository.ts<br/>├── i-endpoint-repository.ts<br/>├── i-log-repository.ts<br/>└── domain-types.ts"]
        F2["src/infrastructure/persistence/<br/>├── persistence.module.ts<br/>├── prisma/<br/>│   ├── prisma-resource.repository.ts<br/>│   ├── prisma-membership.repository.ts<br/>│   └── prisma-endpoint.repository.ts<br/>└── memory/<br/>    ├── in-memory-store.ts<br/>    ├── in-memory-resource.repository.ts<br/>    ├── in-memory-membership.repository.ts<br/>    └── in-memory-endpoint.repository.ts"]
    end

    subgraph P3_FILES["Phase 3 — PostgreSQL"]
        F3["prisma/migrations/<br/>└── YYYYMMDD_unified_resource/<br/>    └── migration.sql<br/>prisma/schema.prisma (updated)<br/>scripts/migrate-data.ts"]
    end

    subgraph P5_FILES["Phase 5 — PATCH Engine"]
        F4["src/domain/services/<br/>├── patch-engine.ts<br/>└── patch-engine.spec.ts"]
    end

    subgraph P6_12_FILES["Phases 6-12"]
        F5["src/domain/services/<br/>├── schema-validator.ts<br/>├── bulk-processor.ts<br/>└── meta-builder.ts<br/>src/infrastructure/persistence/memory/<br/>├── in-memory-schema.repository.ts<br/>└── in-memory-credential.repository.ts<br/>src/infrastructure/persistence/prisma/<br/>├── prisma-schema.repository.ts<br/>└── prisma-credential.repository.ts"]
    end

    subgraph DEPLOY_FILES["Deployment"]
        F6["Dockerfile.memory<br/>docker-compose.postgresql.yml<br/>infra/postgresql.bicep"]
    end

    style P1_FILES fill:#c8e6c9,color:#333
    style P3_FILES fill:#e8f5e9,color:#333
    style P5_FILES fill:#fff9c4,color:#333
    style P6_12_FILES fill:#e3f2fd,color:#333
    style DEPLOY_FILES fill:#f3e5f5,color:#333
```

### File Count Summary

| Category | New Files | Modified Files | Deleted Files |
|----------|:---------:|:--------------:|:-------------:|
| Domain interfaces | 5 | 0 | 0 |
| Domain services | 3 (+3 spec) | 0 | 0 |
| Prisma repositories | 4 | 0 | 0 |
| In-Memory repositories | 6 | 0 | 0 |
| Prisma schema/migrations | 2 | 1 | 0 |
| Existing services (refactored) | 0 | 4 | 0 |
| Module wiring | 2 | 2 | 0 |
| Docker/Deployment | 3 | 2 | 0 |
| Tests | 6 | 8 | 0 |
| **Total** | **31** | **17** | **0** |

---

## Summary — Decision Matrix

| If you have... | Recommended approach | Expected timeline |
|----------------|---------------------|:-----------------:|
| 1 dev, PG only, manual | Follow Migration Plan v3 phases sequentially | 16 weeks |
| 1 dev, PG only, AI-assisted | AI generates repos + code, human reviews | **4-5 weeks** |
| 1 dev, both paths, AI-assisted | AI generates both impls in parallel after P1 | **5-6 weeks** |
| 2 devs, both paths, AI-assisted | Dev A: PG track, Dev B: InMem + domain | **4-5 weeks** |
| 1 dev, InMem only, AI-assisted | Fastest path — skip PG entirely | **3-4 weeks** |

**Bottom line**: AI automation reduces the migration from a **~4-month project** to a **~5-6 week sprint** — with both storage backends delivered and tested.
