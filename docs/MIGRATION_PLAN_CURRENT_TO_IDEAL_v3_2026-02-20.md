# Migration Plan: Current State → Ideal Architecture v3

> **Version**: 3.0 · **Date**: 2026-02-20
> **Companion document**: `IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md`
> **Method**: 12 phases, each independently deployable. No big-bang rewrites.

---

## Table of Contents

1. [Executive Summary of Gaps](#1-executive-summary-of-gaps)
2. [Phase Overview Map](#2-phase-overview-map)
3. [Phase 1 — Repository Pattern (Persistence Agnosticism)](#3-phase-1--repository-pattern)
4. [Phase 2 — Unified `scim_resource` Table](#4-phase-2--unified-scim_resource-table)
5. [Phase 3 — PostgreSQL Migration](#5-phase-3--postgresql-migration)
6. [Phase 4 — Filter Push-Down Expansion](#6-phase-4--filter-push-down-expansion)
7. [Phase 5 — Domain-Layer PATCH Engine](#7-phase-5--domain-layer-patch-engine)
8. [Phase 6 — Data-Driven Discovery](#8-phase-6--data-driven-discovery)
9. [Phase 7 — ETag & Conditional Requests (Strict)](#9-phase-7--etag--conditional-requests)
10. [Phase 8 — Schema Validation](#10-phase-8--schema-validation)
11. [Phase 9 — Bulk Operations](#11-phase-9--bulk-operations)
12. [Phase 10 — /Me Endpoint](#12-phase-10--me-endpoint)
13. [Phase 11 — Per-Tenant Credentials](#13-phase-11--per-tenant-credentials)
14. [Phase 12 — Sorting, Search, and Cleanup](#14-phase-12--sorting-search-and-cleanup)
15. [Risk Matrix & Mitigation](#15-risk-matrix--mitigation)
16. [Dependency Graph](#16-dependency-graph)
17. [Deployment Modes & Per-Phase Impact](#17-deployment-modes--per-phase-impact)

---

## 1. Executive Summary of Gaps

The table below maps every gap between the current codebase and the ideal architecture, with the severity, current file(s) affected, and the migration phase that resolves it.

| # | Gap | Severity | Current File(s) | Ideal Resolution | Phase |
|---|-----|----------|-----------------|------------------|-------|
| G1 | **No Repository Pattern** — services call `PrismaService` directly | HIGH | `endpoint-scim-users.service.ts`, `endpoint-scim-groups.service.ts` | Repository interfaces in Domain layer; Prisma implementations in Infrastructure | 1 |
| G2 | **Separate User/Group tables** (ScimUser, ScimGroup) | MEDIUM | `schema.prisma` | Unified `scim_resource` table with `resource_type` discriminator | 2 |
| G3 | **SQLite** — no CITEXT, no JSONB, no GIN, single-writer lock | HIGH | `schema.prisma` (provider="sqlite") | PostgreSQL with CITEXT, JSONB, GIN, `pg_trgm` | 3 |
| G4 | **Filter push-down only for `eq`** on 3 columns | HIGH | `apply-scim-filter.ts` (`tryPushToDb` returns null for all non-eq ops) | Full operator support via PostgreSQL ILIKE, JSONB operators, `pg_trgm` | 4 |
| G5 | **PATCH engine embedded in service** (~200 lines inline) | HIGH | `endpoint-scim-users.service.ts` (lines 320–440), `endpoint-scim-groups.service.ts` (PATCH handlers) | Standalone `PatchEngine` in Domain layer, schema-aware, zero DB imports | 5 |
| G6 | **Discovery endpoints hardcoded** | MEDIUM | `endpoint-scim-discovery.controller.ts` (private methods, static JSON) | `tenant_schema` + `tenant_resource_type` tables, `DiscoveryService` | 6 |
| G7 | **ETag If-Match NOT enforced** before writes | HIGH | `scim-etag.interceptor.ts` (assertIfMatch exists but never called) | Pre-write check in Orchestrator; monotonic integer version | 7 |
| G8 | **No schema validation** against tenant schema definitions | MEDIUM | None (no validation logic exists) | `SchemaValidator` validates payload against `tenant_schema.attributes` | 8 |
| G9 | **No /Bulk endpoint** | LOW | Missing entirely | `BulkController` + `BulkProcessor` with bulkId resolution | 9 |
| G10 | **No /Me endpoint** | LOW | Missing entirely | `MeController` mapping authenticated user to resource | 10 |
| G11 | **Global shared-secret auth** | MEDIUM | `shared-secret.guard.ts` (single SCIM_SHARED_SECRET for all tenants) | Per-tenant credentials in `tenant_credential` table | 11 |
| G12 | **No sortBy/sortOrder support** | LOW | ServiceProviderConfig returns `sort: {supported: false}` | Sort push-down to DB; in-memory fallback for JSONB paths | 12 |
| G13 | **ETag uses timestamp** (collision-prone) | MEDIUM | `buildMeta()` → `W/"${updatedAt.toISOString()}"` | Monotonic `version INT` column | 7 |
| G14 | **`rawPayload` stored as String** (not JSONB) | MEDIUM | `schema.prisma` → `rawPayload String` | `payload JSONB` column with GIN index | 2,3 |
| G15 | **`userNameLower` / `displayNameLower`** helper columns | LOW | `schema.prisma` | Remove; use PostgreSQL CITEXT for transparent case-insensitivity | 3 |
| G16 | **Extension URN hardcoded** to Enterprise User only | MEDIUM | `scim-patch-path.ts` → `KNOWN_EXTENSION_URNS` | Dynamic from `tenant_schema` rows | 6 |
| G17 | **Code duplication** between User/Group services | MEDIUM | ~600 lines each with isomorphic patterns | Single `ResourceOrchestrator` parameterized by resource type | 2,5 |
| G18 | **No POST /.search** endpoint | LOW | Missing | Add alongside existing GET list | 12 |
| G19 | **Response `schemas[]` never includes extension URNs** | MEDIUM | `toScimUserResource()` hardcodes `schemas[]`; `includeEnterpriseSchema` flag defined (L47) + defaulted false (L204) but **never consumed** at runtime | `schemas[]` dynamically built from `{resource payload keys} ∩ {tenant_schema URNs}` | 6 |
| G20 | **7 of 12 config flags are dead code (58%)** | MEDIUM | `excludeMeta`, `excludeSchemas`, `customSchemaUrn`, `includeEnterpriseSchema`, `strictMode`, `legacyMode`, `customHeaders` — all defined + defaulted but **never consumed** at runtime | Remove dead flags or wire them to behavior; document live-flag contract in tenant config | 6 |

### Gap Heat Map (Severity × Impact on RFC Compliance)

```
                    ┌─────────────────────────────────────────────┐
                    │          SEVERITY ASSESSMENT                 │
                    ├──────────────┬──────────────────────────────┤
  RFC Compliance ───│ HIGH         │ G1 G3 G4 G5 G7             │
                    │              │ (Architectural / data model) │
                    ├──────────────┼──────────────────────────────┤
  Correctness ──────│ MEDIUM       │ G2 G6 G8 G11 G13 G14 G16   │
                    │              │ (Missing per-tenant data)   │
                    ├──────────────┼──────────────────────────────┤
  Completeness ─────│ LOW          │ G9 G10 G12 G15 G17 G18     │
                    │              │ (Features / cleanup)        │
                    └──────────────┴──────────────────────────────┘
```

### Gap Resolution Flow

```mermaid
flowchart LR
    subgraph HIGH["HIGH Severity"]
        G1[G1 No Repo Pattern]
        G3[G3 SQLite]
        G4[G4 Filter eq-only]
        G5[G5 Inline PATCH]
        G7[G7 ETag not enforced]
    end
    subgraph MED["MEDIUM Severity"]
        G2[G2 Separate tables]
        G6[G6 Hardcoded discovery]
        G8[G8 No validation]
        G11[G11 Global auth]
        G13[G13 Timestamp ETag]
        G14[G14 rawPayload String]
        G16[G16 Hardcoded URN]
        G19[G19 schemas[] ignores extensions]
        G20[G20 Dead config flags 58%]
    end
    subgraph LOW["LOW Severity"]
        G9[G9 No /Bulk]
        G10[G10 No /Me]
        G12[G12 No sort]
    end

    G1 -->|Phase 1| P1((P1))
    G2 -->|Phase 2| P2((P2))
    G3 -->|Phase 3| P3((P3))
    G14 -->|Phase 2+3| P3
    G4 -->|Phase 4| P4((P4))
    G5 -->|Phase 5| P5((P5))
    G6 -->|Phase 6| P6((P6))
    G16 -->|Phase 6| P6
    G19 -->|Phase 6| P6
    G20 -->|Phase 6| P6
    G7 -->|Phase 7| P7((P7))
    G13 -->|Phase 7| P7
    G8 -->|Phase 8| P8((P8))
    G9 -->|Phase 9| P9((P9))
    G10 -->|Phase 10| P10((P10))
    G11 -->|Phase 11| P11((P11))
    G12 -->|Phase 12| P12((P12))

    style HIGH fill:#ff6b6b,color:#fff
    style MED fill:#feca57,color:#333
    style LOW fill:#48dbfb,color:#333
```

---

## 2. Phase Overview Map

```
Phase 1  Repository Pattern         ████████ (foundational — all later phases depend)
Phase 2  Unified Resource Table     ██████   (data model alignment)
Phase 3  PostgreSQL Migration       ██████   (infrastructure swap)
Phase 4  Filter Push-Down           ████     (perf + compliance)
Phase 5  Domain PATCH Engine        ██████   (correctness + testability)
Phase 6  Data-Driven Discovery      ████     (per-tenant schema)
Phase 7  ETag & Versioning          ████     (concurrency)
Phase 8  Schema Validation          ████     (strictness)
Phase 9  Bulk Operations            ███      (feature)
Phase 10 /Me Endpoint               ██       (feature)
Phase 11 Per-Tenant Credentials     ████     (security)
Phase 12 Sort, Search, Cleanup      ████     (polish)
```

### Phase Timeline (Estimated)

```
Week  1─2─3─4─5─6─7─8─9─10─11─12─13─14─15─16
Phase 1 ████
Phase 2     ████
Phase 3         ████
Phase 4             ███
Phase 5             ██████
Phase 6                  ███
Phase 7                  ███
Phase 8                     ███
Phase 9                        ███
Phase 10                          ██
Phase 11                          ████
Phase 12                              ████
```

### Phase Timeline (Gantt)

```mermaid
gantt
    title Migration Phase Timeline
    dateFormat  YYYY-MM-DD
    axisFormat  Week %W

    section Critical Path
    P1 Repository Pattern        :crit, p1, 2026-03-02, 2w
    P2 Unified Resource Table    :crit, p2, after p1, 2w
    P3 PostgreSQL Migration      :crit, p3, after p2, 2w
    P5 Domain PATCH Engine       :crit, p5, after p1, 3w

    section Important
    P4 Filter Push-Down          :p4, after p3, 2w
    P6 Data-Driven Discovery     :p6, after p3, 2w
    P7 ETag & Versioning         :p7, after p3, 2w

    section Features
    P8 Schema Validation         :p8, after p6, 2w
    P9 Bulk Operations           :p9, after p5, 2w
    P10 /Me Endpoint             :p10, after p1, 1w
    P11 Per-Tenant Credentials   :p11, after p3, 2w

    section Polish
    P12 Sort, Search, Cleanup    :p12, after p4, 2w
```

### Architecture Layer Migration Overview

```mermaid
flowchart TB
    subgraph CURRENT["Current Architecture"]
        direction TB
        C_CTRL["Controllers<br/>users.controller / groups.controller"]
        C_SVC["Services<br/>users.service (657 LOC)<br/>groups.service (765 LOC)"]
        C_PRISMA["PrismaService<br/>Direct Prisma calls"]
        C_DB[("SQLite<br/>ScimUser + ScimGroup")]

        C_CTRL --> C_SVC
        C_SVC --> C_PRISMA
        C_PRISMA --> C_DB
    end

    subgraph IDEAL["Ideal Architecture (Post-Migration)"]
        direction TB
        I_CTRL["ResourceController<br/>Unified"]
        I_ORCH["ResourceOrchestrator<br/>~500 LOC"]
        I_DOMAIN["Domain Layer<br/>PatchEngine · SchemaValidator<br/>ETagService · BulkProcessor"]
        I_REPO["IResourceRepository<br/>Interface"]
        I_IMPL["PrismaResourceRepository<br/>Implementation"]
        I_DB[("PostgreSQL 17<br/>scim_resource (unified)<br/>JSONB · CITEXT · GIN")]

        I_CTRL --> I_ORCH
        I_ORCH --> I_DOMAIN
        I_ORCH --> I_REPO
        I_REPO -.->|implements| I_IMPL
        I_IMPL --> I_DB
    end

    CURRENT ===>|12 Phases| IDEAL

    style CURRENT fill:#ffcccc,color:#333
    style IDEAL fill:#ccffcc,color:#333
```

---

## 3. Phase 1 — Repository Pattern

### Why First?

Every phase after this one benefits from the persistence abstraction. Without it, changing the database (Phase 3), the table structure (Phase 2), or the query logic (Phase 4) requires modifying business logic files. The Repository Pattern isolates all database-specific code behind interfaces, so the Domain and Application layers never need to change when persistence evolves.

### Current State

Services import and call `PrismaService` directly:

```typescript
// endpoint-scim-users.service.ts (current — lines 4-5, 54-55)
import { PrismaService } from '../../prisma/prisma.service';

constructor(private readonly prisma: PrismaService, ...) {}

// Direct Prisma calls throughout:
const created = await this.prisma.scimUser.create({ data });
const user = await this.prisma.scimUser.findFirst({ where: { scimId, endpointId } });
const allDbUsers = await this.prisma.scimUser.findMany({ where, orderBy: ... });
await this.prisma.scimUser.update({ where: { id: user.id }, data });
await this.prisma.scimUser.delete({ where: { id: user.id } });
```

**Problem**: Services contain both SCIM business logic AND Prisma query construction. Testing SCIM logic requires a running database or extensive mocking of Prisma internals.

### Phase 1 — Refactoring Flow

```mermaid
flowchart LR
    subgraph BEFORE["Before Phase 1"]
        SVC["users.service.ts"]
        SVC -->|"import"| PS["PrismaService"]
        SVC -->|"prisma.scimUser.create()"| DB[(SQLite)]
        SVC -->|"prisma.scimUser.findMany()"| DB
        SVC -->|"prisma.scimUser.update()"| DB
    end

    subgraph AFTER["After Phase 1"]
        SVC2["users.service.ts"]
        SVC2 -->|"inject"| IFACE["IResourceRepository"]
        IFACE -.->|implements| IMPL["PrismaResourceRepository"]
        IMPL -->|"prisma.scimUser.*"| DB2[(SQLite)]
    end

    BEFORE ==>|"Extract interface"| AFTER

    style BEFORE fill:#ffdddd,color:#333
    style AFTER fill:#ddffdd,color:#333
```

### Target State

```
src/
  domain/
    ports/
      resource.repository.ts          ← Interface
      tenant.repository.ts            ← Interface
      schema.repository.ts            ← Interface
      membership.repository.ts        ← Interface
    models/
      scim-resource.model.ts          ← Plain TypeScript types
      tenant.model.ts
      schema.model.ts
  infrastructure/
    persistence/
      prisma/
        prisma-resource.repository.ts  ← Implements IResourceRepository
        prisma-tenant.repository.ts
        prisma-schema.repository.ts
        prisma-membership.repository.ts
```

### Step-by-Step Implementation

#### Step 1.1: Define Repository Interfaces

```typescript
// src/domain/ports/resource.repository.ts

export interface ResourceCreateInput {
  tenantId: string;
  resourceType: string;    // "User" | "Group"
  scimId: string;
  externalId?: string | null;
  userName?: string | null; // Only for Users
  displayName?: string | null;
  active?: boolean;
  payload: Record<string, unknown>;
}

export interface ResourceUpdateInput {
  externalId?: string | null;
  userName?: string | null;
  displayName?: string | null;
  active?: boolean;
  payload?: Record<string, unknown>;
  version?: number; // For optimistic locking
}

export interface ResourceQueryOptions {
  tenantId: string;
  resourceType: string;
  where?: Record<string, unknown>;  // Abstracted filter (not Prisma-specific)
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  offset?: number;
  limit?: number;
}

export interface ResourceQueryResult<T> {
  items: T[];
  totalCount: number;
}

export interface IResourceRepository {
  create(input: ResourceCreateInput): Promise<ScimResourceModel>;
  findById(tenantId: string, scimId: string): Promise<ScimResourceModel | null>;
  findByExternalId(tenantId: string, externalId: string): Promise<ScimResourceModel | null>;
  findByUserName(tenantId: string, userName: string): Promise<ScimResourceModel | null>;
  query(options: ResourceQueryOptions): Promise<ResourceQueryResult<ScimResourceModel>>;
  update(id: string, input: ResourceUpdateInput): Promise<ScimResourceModel>;
  delete(id: string): Promise<void>;
  assertUnique(tenantId: string, userName?: string, externalId?: string, excludeScimId?: string): Promise<void>;
}
```

#### Step 1.2: Define Domain Models

```typescript
// src/domain/models/scim-resource.model.ts

export interface ScimResourceModel {
  id: string;           // Internal storage ID
  tenantId: string;
  resourceType: string;
  scimId: string;        // SCIM-visible id
  externalId: string | null;
  userName: string | null;
  displayName: string | null;
  active: boolean;
  payload: Record<string, unknown>;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
```

#### Step 1.3: Create Prisma Implementation

```typescript
// src/infrastructure/persistence/prisma/prisma-resource.repository.ts

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { IResourceRepository, ResourceCreateInput } from '../../../domain/ports/resource.repository';
import type { ScimResourceModel } from '../../../domain/models/scim-resource.model';

@Injectable()
export class PrismaResourceRepository implements IResourceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: ResourceCreateInput): Promise<ScimResourceModel> {
    // During Phase 1, this delegates to ScimUser or ScimGroup tables
    // After Phase 2, it will use a unified scim_resource table
    if (input.resourceType === 'User') {
      const created = await this.prisma.scimUser.create({
        data: {
          scimId: input.scimId,
          externalId: input.externalId ?? null,
          userName: input.userName!,
          userNameLower: input.userName!.toLowerCase(),
          active: input.active ?? true,
          rawPayload: JSON.stringify(input.payload),
          meta: JSON.stringify({ resourceType: 'User', created: new Date().toISOString(), lastModified: new Date().toISOString() }),
          endpoint: { connect: { id: input.tenantId } }
        }
      });
      return this.toModel(created, 'User');
    }
    // ... similar for Group
    throw new Error(`Unsupported resource type: ${input.resourceType}`);
  }

  // ... other methods

  private toModel(row: any, resourceType: string): ScimResourceModel {
    return {
      id: row.id,
      tenantId: row.endpointId,
      resourceType,
      scimId: row.scimId,
      externalId: row.externalId,
      userName: row.userName ?? null,
      displayName: row.displayName ?? row.displayNameLower ?? null,
      active: row.active ?? true,
      payload: JSON.parse(row.rawPayload ?? '{}'),
      version: 1, // Phase 7 adds real version column
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
```

#### Step 1.4: Wire via NestJS Module

```typescript
// src/modules/scim/scim.module.ts (changes)
{
  provide: 'IResourceRepository',
  useClass: PrismaResourceRepository,
}

// In service constructors:
constructor(
  @Inject('IResourceRepository')
  private readonly resourceRepo: IResourceRepository,
  // ...
) {}
```

#### Step 1.5: Refactor Services Incrementally

Replace `this.prisma.scimUser.xxx()` calls with `this.resourceRepo.xxx()` one method at a time:

| Service Method | Before (direct Prisma) | After (Repository) |
|---------------|----------------------|---------------------|
| `createUserForEndpoint` | `this.prisma.scimUser.create({data})` | `this.resourceRepo.create(input)` |
| `getUserForEndpoint` | `this.prisma.scimUser.findFirst({where})` | `this.resourceRepo.findById(tenantId, scimId)` |
| `listUsersForEndpoint` | `this.prisma.scimUser.findMany({where})` | `this.resourceRepo.query(options)` |
| `replaceUserForEndpoint` | `this.prisma.scimUser.update({where, data})` | `this.resourceRepo.update(id, input)` |
| `deleteUserForEndpoint` | `this.prisma.scimUser.delete({where})` | `this.resourceRepo.delete(id)` |

### Verification

```bash
# All existing tests must pass after Phase 1
npm test -- --coverage

# New unit tests for Domain logic using InMemoryResourceRepository
npm test -- --testPathPattern=domain
```

### Risks

| Risk | Mitigation |
|------|-----------|
| **Regression in existing behavior** | Run full integration test suite after each service method migration |
| **Prisma types leak through interface** | Domain models use plain TS types only; conversion happens in repository |
| **Performance impact of mapping** | `toModel()` is O(1) per record; negligible vs. DB latency |

---

## 4. Phase 2 — Unified `scim_resource` Table

### Why?

Currently, `ScimUser` and `ScimGroup` are separate Prisma models with separate tables. This means:
- User service: 657 lines. Group service: 765 lines. ~60% is structurally identical.
- Adding a new resource type (Device, Application) requires a new model, migration, service, and controller.
- Filter logic is duplicated (`buildUserFilter` / `buildGroupFilter` in `apply-scim-filter.ts`).
- PATCH logic is duplicated (both services have independent PATCH implementations).

### Current Schema

```
                 ┌──────────────┐
     ┌──────────>│  ScimUser    │
     │           │ id, scimId   │
     │           │ userName     │
Endpoint ───────>│ rawPayload   │
     │           │ (String)     │
     │           └──────────────┘
     │
     │           ┌──────────────┐
     └──────────>│  ScimGroup   │
                 │ id, scimId   │
                 │ displayName  │
                 │ rawPayload   │
                 │ (String)     │
                 └──────┬───────┘
                        │
                 ┌──────▼───────┐
                 │ GroupMember   │
                 │ groupId (FK) │
                 │ userId (FK)  │
                 └──────────────┘
```

### Target Schema

```
                 ┌─────────────────┐
                 │  scim_resource   │
                 │ id               │
     ┌──────────>│ tenant_id (FK)   │
     │           │ resource_type    │  ← "User" / "Group"
Endpoint ──────>│ scim_id          │
(tenant)        │ user_name        │  ← NULL for Groups
                 │ display_name     │
                 │ payload (JSONB)  │  ← String until Phase 3
                 │ version (INT)    │  ← 1 until Phase 7
                 └─────────┬───────┘
                           │
                 ┌─────────▼───────┐
                 │ resource_member   │
                 │ group_id (FK)    │
                 │ member_id (FK)   │
                 │ value, display   │
                 └─────────────────┘
```

### Step-by-Step Implementation

#### Step 2.1: Add New Prisma Model (Additive)

```prisma
// schema.prisma — ADD alongside existing models (do NOT remove ScimUser/ScimGroup yet)
model ScimResource {
  id           String   @id @default(cuid())
  endpointId   String
  resourceType String   // "User" or "Group"
  scimId       String
  externalId   String?
  userName     String?
  userNameLower String?  // Kept until Phase 3 (PostgreSQL CITEXT)
  displayName  String?
  displayNameLower String?
  active       Boolean  @default(true)
  rawPayload   String   // Kept as String until Phase 3 (JSONB)
  version      Int      @default(1)
  meta         String?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  endpoint      Endpoint         @relation(fields: [endpointId], references: [id], onDelete: Cascade)
  membersAsGroup ResourceMember[] @relation("GroupMembers")
  membersAsMember ResourceMember[] @relation("MemberResources")

  @@unique([endpointId, scimId])
  @@unique([endpointId, userNameLower])
  @@unique([endpointId, externalId])
  @@index([endpointId, resourceType])
}

model ResourceMember {
  id              String   @id @default(cuid())
  groupResourceId String
  memberResourceId String?
  value           String
  type            String?
  display         String?
  createdAt       DateTime @default(now())

  group  ScimResource  @relation("GroupMembers", fields: [groupResourceId], references: [id], onDelete: Cascade)
  member ScimResource? @relation("MemberResources", fields: [memberResourceId], references: [id], onDelete: SetNull)

  @@index([groupResourceId])
  @@index([memberResourceId])
}
```

#### Step 2.2: Data Migration Script

```typescript
// scripts/migrate-to-unified-resource.ts
async function migrateUsers(prisma: PrismaClient) {
  const users = await prisma.scimUser.findMany();
  for (const user of users) {
    await prisma.scimResource.create({
      data: {
        endpointId: user.endpointId,
        resourceType: 'User',
        scimId: user.scimId,
        externalId: user.externalId,
        userName: user.userName,
        userNameLower: user.userNameLower,
        active: user.active,
        rawPayload: user.rawPayload,
        meta: user.meta,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }
    });
  }
}

async function migrateGroups(prisma: PrismaClient) {
  const groups = await prisma.scimGroup.findMany({ include: { members: true } });
  for (const group of groups) {
    const resource = await prisma.scimResource.create({
      data: {
        endpointId: group.endpointId,
        resourceType: 'Group',
        scimId: group.scimId,
        externalId: group.externalId,
        displayName: group.displayName,
        displayNameLower: group.displayNameLower,
        rawPayload: group.rawPayload,
        meta: group.meta,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      }
    });
    
    for (const member of group.members) {
      // Resolve member's ScimResource id
      const memberResource = await prisma.scimResource.findFirst({
        where: { endpointId: group.endpointId, scimId: member.value }
      });
      await prisma.resourceMember.create({
        data: {
          groupResourceId: resource.id,
          memberResourceId: memberResource?.id ?? null,
          value: member.value,
          type: member.type,
          display: member.display,
        }
      });
    }
  }
}
```

#### Step 2.3: Update `PrismaResourceRepository`

The repository (created in Phase 1) now targets `ScimResource` instead of `ScimUser`/`ScimGroup`:

```typescript
// BEFORE (Phase 1 bridge):
await this.prisma.scimUser.create({data});

// AFTER (Phase 2):
await this.prisma.scimResource.create({data: {..., resourceType: 'User'}});
```

#### Step 2.4: Merge User/Group Services into ResourceOrchestrator

```typescript
// Before: 2 services × ~700 lines = ~1400 lines
// After: 1 orchestrator × ~500 lines

// src/application/resource.orchestrator.ts
@Injectable()
export class ResourceOrchestrator {
  constructor(
    @Inject('IResourceRepository') private readonly resourceRepo: IResourceRepository,
    @Inject('IMembershipRepository') private readonly memberRepo: IMembershipRepository,
    private readonly patchEngine: IPatchEngine,  // Placeholder until Phase 5
  ) {}

  async create(tenantId: string, resourceType: string, dto: any, baseUrl: string) {
    // Generic create — works for User, Group, or any future type
  }

  async get(tenantId: string, scimId: string, baseUrl: string) {
    // Generic get
  }

  // ... list, replace, patch, delete
}
```

#### Step 2.5: Remove Old Models

After data migration is verified and all tests pass against the new unified table:

```prisma
// REMOVE from schema.prisma:
// model ScimUser { ... }
// model ScimGroup { ... }
// model GroupMember { ... }
```

### Lines of Code Impact

| Component | Before | After | Change |
|-----------|--------|-------|--------|
| `endpoint-scim-users.service.ts` | 657 | 0 (deleted) | -657 |
| `endpoint-scim-groups.service.ts` | 765 | 0 (deleted) | -765 |
| `resource.orchestrator.ts` | — | ~500 | +500 |
| `prisma-resource.repository.ts` | ~150 | ~300 | +150 |
| `apply-scim-filter.ts` | 170 | ~120 | -50 |
| **Net** | **~1742** | **~920** | **-822** |

### Phase 2 — Data Migration Flow

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant PRISMA as Prisma CLI
    participant SCRIPT as migrate-to-unified.ts
    participant OLD as ScimUser + ScimGroup
    participant NEW as scim_resource
    participant TEST as Test Suite

    DEV->>PRISMA: prisma migrate dev --name unified-resource
    PRISMA->>NEW: CREATE TABLE scim_resource (additive)
    Note over OLD,NEW: Both tables coexist

    DEV->>SCRIPT: npx ts-node scripts/migrate-to-unified.ts
    SCRIPT->>OLD: SELECT * FROM ScimUser
    SCRIPT->>NEW: INSERT INTO scim_resource (type='User')
    SCRIPT->>OLD: SELECT * FROM ScimGroup + GroupMember
    SCRIPT->>NEW: INSERT INTO scim_resource (type='Group') + resource_member

    DEV->>TEST: npm run test:ci
    TEST-->>DEV: ✅ All passing

    DEV->>PRISMA: Remove ScimUser/ScimGroup models
    PRISMA->>OLD: DROP TABLE ScimUser, ScimGroup, GroupMember
```

---

## 5. Phase 3 — PostgreSQL Migration

### Why?

SQLite was a pragmatic starting choice, but creates 28 documented compromises (see `docs/SQLITE_COMPROMISE_ANALYSIS.md`). The top issues:

| SQLite Limitation | Impact | PostgreSQL Solution |
|------------------|--------|-------------------|
| No CITEXT | `userNameLower` / `displayNameLower` helper columns | CITEXT type; remove helper columns |
| No JSONB | `rawPayload String` — all queries require `JSON.parse()` | `payload JSONB` with GIN indexing |
| No ILIKE | `co`/`sw`/`ew` filters can't push to DB | ILIKE + `pg_trgm` extension |
| Single-writer lock | Concurrent PATCH operations block | Row-level locking; full concurrency |
| No partial unique index | `externalId` NULL uniqueness issues | `WHERE externalId IS NOT NULL` partial index |

### Step-by-Step Implementation

#### Step 3.1: Update Prisma Datasource

```prisma
// schema.prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

#### Step 3.2: Update ScimResource Model for PostgreSQL

```prisma
model ScimResource {
  id            String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  endpointId    String   @db.Uuid
  resourceType  String   @db.VarChar(50)
  scimId        String   @db.Uuid
  externalId    String?  @db.VarChar(255)
  userName      String?  @db.Citext        // ← CITEXT replaces userNameLower
  displayName   String?  @db.Citext        // ← CITEXT replaces displayNameLower
  active        Boolean  @default(true)
  payload       Json                        // ← JSONB replaces rawPayload String
  version       Int      @default(1)
  createdAt     DateTime @default(now()) @db.Timestamptz
  updatedAt     DateTime @updatedAt @db.Timestamptz

  // ... relations unchanged
  
  // Remove userNameLower, displayNameLower — no longer needed
  @@unique([endpointId, scimId])
  @@unique([endpointId, userName])      // CITEXT handles case-insensitivity
  @@index([endpointId, resourceType])
}
```

#### Step 3.3: Remove Helper Columns from Repository

```typescript
// BEFORE (Phase 1-2 with SQLite):
await this.prisma.scimResource.create({
  data: {
    userName: input.userName,
    userNameLower: input.userName?.toLowerCase(),  // ← REMOVE
    displayNameLower: input.displayName?.toLowerCase(), // ← REMOVE
    // ...
  }
});

// AFTER (Phase 3 with PostgreSQL):
await this.prisma.scimResource.create({
  data: {
    userName: input.userName,  // CITEXT handles case-insensitivity natively
    displayName: input.displayName,
    // ...
  }
});
```

#### Step 3.4: Update Docker Compose

```yaml
# docker-compose.yml
services:
  api:
    build: ./api
    environment:
      DATABASE_URL: postgresql://scim:scim@postgres:5432/scimdb
    depends_on:
      postgres:
        condition: service_healthy

  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_DB: scimdb
      POSTGRES_USER: scim
      POSTGRES_PASSWORD: scim
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U scim"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

#### Step 3.5: Create PostgreSQL Extension Migration

```sql
-- prisma/migrations/xxx_enable_extensions/migration.sql
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- for co/sw/ew filter push-down
```

#### Step 3.6: Add GIN Indexes

```sql
-- prisma/migrations/xxx_add_gin_indexes/migration.sql
CREATE INDEX idx_resource_payload_gin 
  ON "ScimResource" USING GIN (payload jsonb_path_ops);

CREATE INDEX idx_resource_username_trgm 
  ON "ScimResource" USING GIN ("userName" gin_trgm_ops);

CREATE INDEX idx_resource_displayname_trgm 
  ON "ScimResource" USING GIN ("displayName" gin_trgm_ops);
```

### Data Migration Strategy

```
┌──────────────────────┐
│ 1. Deploy PostgreSQL  │
│    alongside SQLite   │
├──────────────────────┤
│ 2. Run data migration │  ← Script reads SQLite, writes PostgreSQL
│    (one-time)         │
├──────────────────────┤
│ 3. Switch datasource  │  ← Change env var to PostgreSQL URL
│    in config          │
├──────────────────────┤
│ 4. Verify all tests   │
│    pass               │
├──────────────────────┤
│ 5. Remove SQLite       │  ← Remove better-sqlite3 dependency
│    artifacts          │
└──────────────────────┘
```

### Phase 3 — Database Transition Sequence

```mermaid
sequenceDiagram
    participant DEV as Developer
    participant SCHEMA as schema.prisma
    participant SQLITE as SQLite DB
    participant PG as PostgreSQL 17
    participant APP as SCIMServer
    participant TESTS as Test Suite

    rect rgb(255, 240, 240)
        Note over DEV,PG: Step 1 — Dual Database Setup
        DEV->>PG: docker run postgres:17-alpine
        DEV->>SCHEMA: provider = "postgresql"
        DEV->>PG: CREATE EXTENSION citext, pgcrypto, pg_trgm
        DEV->>PG: prisma migrate deploy (fresh schema)
    end

    rect rgb(255, 255, 230)
        Note over DEV,PG: Step 2 — Data Migration
        DEV->>SQLITE: Read all ScimUser + ScimGroup rows
        DEV->>PG: Write to scim_resource (unified table)
        DEV->>DEV: Compare row counts (assert match)
    end

    rect rgb(230, 255, 230)
        Note over DEV,TESTS: Step 3 — Validation
        DEV->>APP: Switch DATABASE_URL to postgresql://...
        APP->>PG: All operations now use PostgreSQL
        DEV->>TESTS: npm run test:ci
        TESTS-->>DEV: ✅ All passing
        DEV->>TESTS: npm run test:smoke
        TESTS-->>DEV: ✅ Live tests passing
    end

    rect rgb(230, 230, 255)
        Note over DEV,SQLITE: Step 4 — Cleanup
        DEV->>SCHEMA: Remove better-sqlite3 dependency
        DEV->>SCHEMA: Remove @prisma/adapter-better-sqlite3
        DEV->>SQLITE: Archive .db file (keep 1 sprint)
    end
```

### Phase 3 — PostgreSQL Schema Visualization

```mermaid
erDiagram
    scim_resource {
        uuid id PK
        uuid endpoint_id FK
        varchar resource_type "User | Group"
        uuid scim_id UK
        varchar external_id
        citext user_name UK "NULL for Groups"
        citext display_name
        boolean active "default true"
        jsonb payload "GIN indexed"
        int version "default 1"
        timestamptz created_at
        timestamptz updated_at
    }

    resource_member {
        uuid id PK
        uuid group_resource_id FK
        uuid member_resource_id FK
        varchar value
        varchar type
        varchar display
    }

    tenant_schema {
        uuid id PK
        uuid endpoint_id FK
        varchar schema_urn UK
        varchar name
        jsonb attributes
    }

    tenant_resource_type {
        uuid id PK
        uuid endpoint_id FK
        varchar name UK
        varchar endpoint_path
        varchar base_schema_urn
        jsonb schema_extensions
    }

    tenant_credential {
        uuid id PK
        uuid endpoint_id FK
        varchar credential_type
        varchar credential_hash
        jsonb metadata
        boolean active
        timestamptz expires_at
    }

    Endpoint ||--o{ scim_resource : "has"
    scim_resource ||--o{ resource_member : "group has members"
    scim_resource ||--o{ resource_member : "is member of"
    Endpoint ||--o{ tenant_schema : "defines schemas"
    Endpoint ||--o{ tenant_resource_type : "defines types"
    Endpoint ||--o{ tenant_credential : "authenticates via"
```

---

## 6. Phase 4 — Filter Push-Down Expansion

### Why?

Currently, `tryPushToDb()` in `apply-scim-filter.ts` only handles the `eq` operator on 3 mapped columns. ALL other operators and ALL compound expressions fall to `fetchAll: true` + in-memory evaluation. This means:

```
Filter: userName co "john"       → fetchAll ✗ (full table scan)
Filter: active eq true           → fetchAll ✗ (active not in column map)
Filter: userName eq "j" and ...  → fetchAll ✗ (AND node, not simple compare)
```

After PostgreSQL migration, we can push ALL operators to the database.

### Current vs. Target Push-Down Matrix

| Filter Expression | Current | After Phase 4 |
|------------------|---------|---------------|
| `userName eq "john"` | ✅ DB (via userNameLower) | ✅ DB (via CITEXT) |
| `userName co "john"` | ❌ fetchAll + in-memory | ✅ DB: `ILIKE '%john%'` (pg_trgm) |
| `userName sw "j"` | ❌ fetchAll + in-memory | ✅ DB: `ILIKE 'j%'` (pg_trgm) |
| `emails.value eq "x@y.com"` | ❌ fetchAll + in-memory | ✅ DB: `payload @> '{"emails":[{"value":"x@y.com"}]}'` |
| `active eq true` | ❌ fetchAll + in-memory | ✅ DB: `active = true` (add to column map) |
| `userName eq "j" AND active eq true` | ❌ fetchAll + in-memory | ✅ DB: compound WHERE |
| `userName eq "j" OR displayName eq "j"` | ❌ fetchAll + in-memory | ✅ DB: `OR` clause |

### Step-by-Step Implementation

#### Step 4.1: Expand Column Map

```typescript
// BEFORE:
const RESOURCE_DB_COLUMNS: Record<string, string> = {
  username: 'userName',   // Now CITEXT — no need for userNameLower
  externalid: 'externalId',
  id: 'scimId',
};

// AFTER:
const RESOURCE_DB_COLUMNS: Record<string, { column: string; type: 'citext' | 'varchar' | 'boolean' | 'uuid' }> = {
  username:     { column: 'userName',    type: 'citext' },
  displayname:  { column: 'displayName', type: 'citext' },
  externalid:   { column: 'externalId',  type: 'varchar' },
  id:           { column: 'scimId',      type: 'uuid' },
  active:       { column: 'active',      type: 'boolean' },
};
```

#### Step 4.2: Expand `tryPushToDb` to Handle All Operators

```typescript
function pushCompareToDb(
  node: CompareNode,
  columnMap: typeof RESOURCE_DB_COLUMNS,
): Record<string, unknown> | null {
  const attrLower = node.attrPath.toLowerCase();
  const mapped = columnMap[attrLower];

  if (mapped) {
    // Indexed column — push to SQL
    return buildColumnFilter(mapped.column, mapped.type, node.op, node.value);
  }

  // JSONB path — push via JSONB operators (PostgreSQL only)
  return buildJsonbFilter(node.attrPath, node.op, node.value);
}

function buildColumnFilter(column: string, type: string, op: string, value: unknown): Record<string, unknown> {
  switch (op) {
    case 'eq': return { [column]: value };
    case 'ne': return { [column]: { not: value } };
    case 'co': return { [column]: { contains: String(value), mode: 'insensitive' } };
    case 'sw': return { [column]: { startsWith: String(value), mode: 'insensitive' } };
    case 'ew': return { [column]: { endsWith: String(value), mode: 'insensitive' } };
    case 'gt': return { [column]: { gt: value } };
    case 'ge': return { [column]: { gte: value } };
    case 'lt': return { [column]: { lt: value } };
    case 'le': return { [column]: { lte: value } };
    case 'pr': return { [column]: { not: null } };
    default: return null;
  }
}
```

#### Step 4.3: Handle Compound Expressions (AND / OR)

```typescript
function pushLogicalToDb(
  node: LogicalNode,
  columnMap: typeof RESOURCE_DB_COLUMNS,
): Record<string, unknown> | null {
  const left = pushNodeToDb(node.left, columnMap);
  const right = pushNodeToDb(node.right, columnMap);

  if (node.op === 'and') {
    // For AND: even if one side can't push, push what we can and post-filter
    if (left && right) return { AND: [left, right] };
    if (left) return left;   // partial push + in-memory for right
    if (right) return right; // partial push + in-memory for left
    return null;
  }

  if (node.op === 'or') {
    // For OR: BOTH must be pushable, otherwise fetchAll
    if (left && right) return { OR: [left, right] };
    return null;
  }

  return null;
}
```

### Performance Impact (Estimated)

| Query Pattern | Before (SQLite fetchAll) | After (PostgreSQL push-down) |
|--------------|-------------------------|------------------------------|
| `userName co "john"` on 10K users | ~50ms (scan all, filter in memory) | ~2ms (GIN index) |
| `active eq true` on 10K users | ~30ms (scan all) | ~1ms (B-tree) |
| `userName eq "j" AND active eq true` | ~40ms (scan all) | ~1ms (compound index) |

### Phase 4 — Filter Processing Pipeline

```mermaid
flowchart TD
    REQ["GET /Users?filter=userName co 'john' and active eq true"]
    PARSE["Parse SCIM Filter<br/>→ AST"]
    
    REQ --> PARSE
    PARSE --> AST{"AST Node Type?"}
    
    AST -->|LogicalNode AND| SPLIT["Split left + right"]
    SPLIT --> LEFT["Left: userName co 'john'"]
    SPLIT --> RIGHT["Right: active eq true"]
    
    LEFT --> COLMAP{"In column map?"}
    COLMAP -->|"Yes (citext)"| PUSH_L["Push: ILIKE '%john%'<br/>via pg_trgm GIN index"]
    COLMAP -->|"No"| JSONB_L["Push: payload @> ...<br/>via JSONB GIN index"]
    
    RIGHT --> COLMAP2{"In column map?"}
    COLMAP2 -->|"Yes (boolean)"| PUSH_R["Push: active = true<br/>via B-tree index"]
    
    PUSH_L --> COMBINE["Combine: AND clause"]
    PUSH_R --> COMBINE
    JSONB_L --> COMBINE
    
    COMBINE --> DB[("PostgreSQL<br/>Single indexed query")]
    DB --> RESULT["Return filtered results<br/>~2ms vs ~50ms"]

    style REQ fill:#e3f2fd,color:#333
    style DB fill:#c8e6c9,color:#333
    style RESULT fill:#c8e6c9,color:#333
```

---

## 7. Phase 5 — Domain-Layer PATCH Engine

### Why?

The PATCH implementation is the most complex part of the SCIM server. Currently it's:
- **200+ lines embedded in `endpoint-scim-users.service.ts`** (lines 320-440)
- **Separate implementation in `endpoint-scim-groups.service.ts`** for group PATCH
- Mixed with Prisma types, endpoint config access, and uniqueness checks
- Difficult to unit test without database mocking

RFC 7644 §3.5.2 defines precise semantics for `add`, `replace`, `remove` — these are pure data transformations that should be testable without a database.

### Current PATCH Flow

```
patchUserForEndpoint()
  │
  ├─ 1. Find user (Prisma query)
  ├─ 2. Loop over operations
  │     ├─ Check op type
  │     ├─ Check path type (simple/valuePath/extension/dot/no-path)
  │     ├─ Apply to rawPayload (JSON.parse → mutate → JSON.stringify)
  │     ├─ Extract first-class fields (active, userName, externalId)
  │     └─ (all inline, ~200 lines of if/else chains)
  ├─ 3. Check uniqueness (Prisma query)
  └─ 4. Update user (Prisma query)
```

**Problem**: Steps 2 is pure domain logic but is tangled with steps 1, 3, 4 (infrastructure).

### Target PATCH Flow

```
ResourceOrchestrator.patch()
  │
  ├─ 1. resourceRepo.findById()              ← Infrastructure
  ├─ 2. etagService.assertIfMatch()           ← Domain
  ├─ 3. patchEngine.apply(payload, ops, schema) ← Domain (PURE)
  │     ├─ Validates paths against schema
  │     ├─ Checks mutability (readOnly → error)
  │     ├─ Handles all path types
  │     ├─ Returns PatchResult
  │     └─ ZERO database calls
  ├─ 4. schemaValidator.validate(result)       ← Domain
  ├─ 5. resourceRepo.assertUnique()            ← Infrastructure
  └─ 6. resourceRepo.update(id, result)        ← Infrastructure
```

### Phase 5 — PATCH Operation Sequence Diagram

```mermaid
sequenceDiagram
    participant CLIENT as IdP Client
    participant CTRL as ResourceController
    participant ORCH as ResourceOrchestrator
    participant ETAG as ETagService
    participant PATCH as PatchEngine
    participant VALID as SchemaValidator
    participant REPO as IResourceRepository
    participant DB as PostgreSQL

    CLIENT->>CTRL: PATCH /Users/abc123<br/>If-Match: W/"v5"<br/>Body: {Operations: [...]}
    CTRL->>ORCH: patch(tenantId, "abc123", ops, "W/\"v5\"")

    rect rgb(230, 245, 255)
        Note over ORCH,DB: Infrastructure — Read
        ORCH->>REPO: findById(tenantId, "abc123")
        REPO->>DB: SELECT * FROM scim_resource WHERE scim_id = 'abc123'
        DB-->>REPO: {payload, version: 5, ...}
        REPO-->>ORCH: ScimResourceModel
    end

    rect rgb(255, 245, 230)
        Note over ORCH,VALID: Domain — Pure Logic (no DB)
        ORCH->>ETAG: assertIfMatch("W/\"v5\"", version=5)
        ETAG-->>ORCH: ✅ Match

        ORCH->>PATCH: apply(payload, operations, config, schema)
        PATCH->>PATCH: Validate paths against schema
        PATCH->>PATCH: Apply add/replace/remove ops
        PATCH->>PATCH: Extract first-class fields
        PATCH-->>ORCH: PatchResult {payload, extractedFields}

        ORCH->>VALID: validate(result.payload, schema)
        VALID-->>ORCH: ✅ Valid
    end

    rect rgb(230, 255, 230)
        Note over ORCH,DB: Infrastructure — Write
        ORCH->>REPO: assertUnique(tenantId, extractedFields)
        REPO->>DB: SELECT ... WHERE userName = ...
        DB-->>REPO: No conflict
        ORCH->>REPO: update(id, result, version: {increment: 1})
        REPO->>DB: UPDATE scim_resource SET ... version = 6
        DB-->>REPO: Updated row
        REPO-->>ORCH: ScimResourceModel {version: 6}
    end

    ORCH-->>CTRL: ScimResourceModel
    CTRL-->>CLIENT: 200 OK<br/>ETag: W/"v6"<br/>Body: {updated user JSON}
```

### Step-by-Step Implementation

#### Step 5.1: Extract PatchEngine Interface

```typescript
// src/domain/patch/patch-engine.ts (NO framework imports)

export interface PatchOperation {
  op: 'add' | 'replace' | 'remove';
  path?: string;
  value?: unknown;
}

export interface PatchResult {
  payload: Record<string, unknown>;
  extractedFields: {
    userName?: string;
    displayName?: string;
    externalId?: string | null;
    active?: boolean;
  };
  memberOperations?: MemberPatchOp[];
}

export interface MemberPatchOp {
  action: 'add' | 'remove' | 'replace';
  members: Array<{ value: string; display?: string; type?: string }>;
}

export interface SchemaDefinition {
  attributes: SchemaAttribute[];
}

export interface SchemaAttribute {
  name: string;
  type: 'string' | 'boolean' | 'complex' | 'reference' | 'decimal' | 'integer' | 'dateTime' | 'binary';
  multiValued: boolean;
  mutability: 'readOnly' | 'readWrite' | 'immutable' | 'writeOnly';
  subAttributes?: SchemaAttribute[];
}

export class PatchEngine {
  apply(
    currentPayload: Record<string, unknown>,
    operations: PatchOperation[],
    config: { verbosePatch: boolean; multiMemberAdd: boolean; multiMemberRemove: boolean; allowRemoveAllMembers: boolean },
    schema?: SchemaDefinition,
  ): PatchResult {
    let payload = { ...currentPayload };
    const extractedFields: PatchResult['extractedFields'] = {};
    const memberOps: MemberPatchOp[] = [];

    for (const op of operations) {
      this.validateOp(op);
      
      if (this.isMemberPath(op.path)) {
        memberOps.push(this.processMemberOp(op, config));
        continue;
      }
      
      const result = this.applyOp(payload, op, config, schema);
      payload = result.payload;
      Object.assign(extractedFields, result.extractedFields);
    }

    return { payload, extractedFields, memberOperations: memberOps };
  }

  // ... private methods for each op type, path resolution, etc.
  // These are extracted from the current inline code in endpoint-scim-users.service.ts
}
```

#### Step 5.2: Write Unit Tests (Before Moving Code)

```typescript
// test/domain/patch-engine.spec.ts

describe('PatchEngine', () => {
  const engine = new PatchEngine();
  const defaultConfig = { verbosePatch: false, multiMemberAdd: true, multiMemberRemove: true, allowRemoveAllMembers: true };

  describe('add operations', () => {
    it('adds simple attribute', () => {
      const result = engine.apply(
        { displayName: 'Old' },
        [{ op: 'add', path: 'title', value: 'Engineer' }],
        defaultConfig
      );
      expect(result.payload.title).toBe('Engineer');
    });

    it('adds to multi-valued attribute', () => {
      const result = engine.apply(
        { emails: [{ value: 'a@b.com', type: 'work' }] },
        [{ op: 'add', path: 'emails', value: [{ value: 'c@d.com', type: 'home' }] }],
        defaultConfig,
      );
      expect(result.payload.emails).toHaveLength(2);
    });

    it('no-path add merges object', () => {
      const result = engine.apply(
        { displayName: 'Old' },
        [{ op: 'add', value: { title: 'Engineer', active: false } }],
        defaultConfig,
      );
      expect(result.payload.title).toBe('Engineer');
      expect(result.extractedFields.active).toBe(false);
    });
  });

  describe('replace operations', () => {
    it('replaces userName (extracts to first-class field)', () => {
      const result = engine.apply(
        {},
        [{ op: 'replace', path: 'userName', value: 'new@example.com' }],
        defaultConfig
      );
      expect(result.extractedFields.userName).toBe('new@example.com');
    });
  });

  describe('remove operations', () => {
    it('rejects remove without path', () => {
      expect(() => engine.apply(
        {},
        [{ op: 'remove' }],
        defaultConfig
      )).toThrow();
    });

    it('removes valuePath entry', () => {
      const result = engine.apply(
        { emails: [{ value: 'a@b.com', type: 'work' }, { value: 'c@d.com', type: 'home' }] },
        [{ op: 'remove', path: 'emails[type eq "home"]' }],
        defaultConfig,
      );
      expect(result.payload.emails).toHaveLength(1);
    });
  });

  describe('extension paths', () => {
    it('handles urn:...:User:department', () => {
      const result = engine.apply(
        {},
        [{ op: 'replace', path: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department', value: 'Eng' }],
        defaultConfig,
      );
      const ext = result.payload['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'] as Record<string, unknown>;
      expect(ext.department).toBe('Eng');
    });
  });

  describe('config flag enforcement', () => {
    it('rejects multi-member add when flag is false', () => {
      expect(() => engine.apply(
        {},
        [{ op: 'add', path: 'members', value: [{ value: 'a' }, { value: 'b' }] }],
        { ...defaultConfig, multiMemberAdd: false },
      )).toThrow();
    });
  });
});
```

#### Step 5.3: Move Code from Services to PatchEngine

Extract the following code blocks into the new `PatchEngine` class:

| Current Location | Lines | Description | New Location |
|-----------------|-------|-------------|-------------|
| `endpoint-scim-users.service.ts` L320-440 | ~120 | `applyPatchOperationsForEndpoint()` loop body | `PatchEngine.applyOp()` |
| `endpoint-scim-users.service.ts` L455-510 | ~55 | `normalizeObjectKeys()` | `PatchEngine.normalizeKeys()` |
| `endpoint-scim-users.service.ts` L510-530 | ~20 | `stripReservedAttributes()` | `PatchEngine.stripExtracted()` |
| `endpoint-scim-users.service.ts` L530-600 | ~70 | Boolean/String extractors | `PatchEngine.extractValue()` |
| `endpoint-scim-groups.service.ts` ~L380-550 | ~170 | `handleAdd/Replace/Remove` for groups | `PatchEngine.processMemberOp()` |
| `scim-patch-path.ts` | 418 | All path parsing/application utilities | `domain/patch/patch-path.ts` |

### Phase 5 — Code Extraction Map

```mermaid
flowchart LR
    subgraph BEFORE["Current: Inline PATCH (~400 LOC across 2 services)"]
        US["users.service.ts<br/>L320-440: applyPatch<br/>L455-530: normalizers<br/>L530-600: extractors"]
        GS["groups.service.ts<br/>L380-550: handleAdd/Replace/Remove"]
        PP["scim-patch-path.ts<br/>418 LOC: path parsing"]
    end

    subgraph AFTER["After: Domain PatchEngine"]
        PE["domain/patch/patch-engine.ts<br/>apply() · applyOp()<br/>processMemberOp()"]
        PPF["domain/patch/patch-path.ts<br/>parsePath() · resolvePath()"]
        PT["test/domain/patch-engine.spec.ts<br/>~80 unit tests"]
    end

    US -->|extract| PE
    GS -->|extract| PE
    PP -->|move| PPF
    PE -.->|tested by| PT

    style BEFORE fill:#ffdddd,color:#333
    style AFTER fill:#ddffdd,color:#333
```

---

## 8. Phase 6 — Data-Driven Discovery

### Why?

Currently, the discovery controller returns **hardcoded JSON** from private methods:

```typescript
// endpoint-scim-discovery.controller.ts (current)
private userSchema() {
  return {
    id: 'urn:ietf:params:scim:schemas:core:2.0:User',
    name: 'User',
    attributes: [
      { name: 'userName', type: 'string', ... },
      // ... hardcoded attribute list
    ]
  };
}
```

This means:
- All tenants see the same schemas (no per-tenant schema customization)
- Adding attributes requires code changes + redeployment
- Enterprise extension is hardcoded to a single URN
- ServiceProviderConfig says `bulk: {supported: false}` even when bulk is implemented

### Current Config Flag Audit

> _Sourced from deep analysis audit — see `SCIM_EXTENSIONS_DEEP_ANALYSIS.md` §2C for line-level references._

Of the 12 config flags defined in the endpoint config model, **only 5 are live** (actually consumed at runtime). The remaining 7 are **dead code** — defined and defaulted but never read:

| Flag | Status | Where Consumed (if live) |
|------|--------|-------------------------|
| `MultiOpPatchRequestAddMultipleMembersToGroup` | LIVE | `groups.service.ts` L189 |
| `MultiOpPatchRequestRemoveMultipleMembersFromGroup` | LIVE | `groups.service.ts` L190 |
| `PatchOpAllowRemoveAllMembers` | LIVE | `groups.service.ts` L192 |
| `VerbosePatchSupported` | LIVE | `users.service.ts` L323 |
| `logLevel` | LIVE | `endpoint.service.ts` L48 |
| `excludeMeta` | DEAD | Defined L45, defaulted false L200 — never consumed |
| `excludeSchemas` | DEAD | Defined L46, defaulted false L201 — never consumed |
| `customSchemaUrn` | DEAD | Defined L48, defaulted null L203 — never consumed |
| `includeEnterpriseSchema` | DEAD | Defined L47, defaulted false L204 — never consumed (**also G19**) |
| `strictMode` | DEAD | Defined L49, defaulted false L205 — never consumed |
| `legacyMode` | DEAD | Defined L50, defaulted false L206 — never consumed |
| `customHeaders` | DEAD | Defined L51, defaulted null L207 — never consumed |

**Impact:** Phase 6 must decide per flag: wire to behavior, or remove. The dead discovery-related flags (`excludeMeta`, `excludeSchemas`, `includeEnterpriseSchema`, `customSchemaUrn`) should be replaced by the data-driven `tenant_schema` model.

### ServiceProviderConfig Compliance Gaps

> _Sourced from RFC 7644 §4, Table 1 audit — see `SCIM_EXTENSIONS_DEEP_ANALYSIS.md` §2B for full compliance table._

The current `ServiceProviderConfig` response is missing 4 required or best-practice fields:

| Missing Field | RFC Requirement | Current Behavior | Fix |
|---------------|----------------|------------------|-----|
| `bulk.maxOperations` | REQUIRED when bulk supported | Missing entirely | Add `maxOperations: 1000` (configurable per tenant) |
| `bulk.maxPayloadSize` | REQUIRED when bulk supported | Missing entirely | Add `maxPayloadSize: 1048576` (1 MB, configurable) |
| `meta` object | SHOULD (§3.1) | Missing from SPC response | Add `meta: {resourceType: "ServiceProviderConfig", created: ..., location: ...}` |
| `documentationUri` | OPTIONAL but best practice | Missing | Add `documentationUri` pointing to tenant docs |

Additionally, the current ServiceProviderConfig response is **identical for all endpoints** — it ignores per-endpoint config. Phase 6 must derive SPC dynamically from `tenant.config` JSONB so that each tenant's capabilities are accurately reflected.

### Target State

Discovery endpoints read from `tenant_schema` and `tenant_resource_type` tables:

```
GET /tenants/{id}/Schemas
  → DiscoveryService.listSchemas(tenantId)
    → schemaRepo.findByTenant(tenantId)
      → SELECT * FROM tenant_schema WHERE tenant_id = $1

GET /tenants/{id}/ResourceTypes
  → DiscoveryService.listResourceTypes(tenantId)
    → resourceTypeRepo.findByTenant(tenantId)
      → SELECT * FROM tenant_resource_type WHERE tenant_id = $1

GET /tenants/{id}/ServiceProviderConfig
  → DiscoveryService.getServiceProviderConfig(tenantId)
    → Derived from tenant.config JSONB
```

### Step-by-Step Implementation

#### Step 6.1: Add Database Models

```prisma
model TenantSchema {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  endpointId  String   @db.Uuid
  schemaUrn   String   @db.VarChar(255)
  name        String   @db.VarChar(100)
  description String?
  attributes  Json     // JSONB array of attribute definitions
  createdAt   DateTime @default(now()) @db.Timestamptz

  endpoint Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@unique([endpointId, schemaUrn])
}

model TenantResourceType {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  endpointId       String   @db.Uuid
  name             String   @db.VarChar(100)
  endpoint_path    String   @db.VarChar(100)  // "/Users"
  description      String?
  baseSchemaUrn    String   @db.VarChar(255)
  schemaExtensions Json     // [{schema: "urn:...", required: false}]
  createdAt        DateTime @default(now()) @db.Timestamptz

  endpoint Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@unique([endpointId, name])
}
```

#### Step 6.2: Seed Default Schemas on Tenant Creation

```typescript
// When creating a new tenant, seed the standard SCIM schemas:
async function seedDefaultSchemas(tenantId: string, prisma: PrismaClient) {
  await prisma.tenantSchema.createMany({
    data: [
      {
        endpointId: tenantId,
        schemaUrn: 'urn:ietf:params:scim:schemas:core:2.0:User',
        name: 'User',
        description: 'User Account',
        attributes: USER_SCHEMA_ATTRIBUTES,  // From constants
      },
      {
        endpointId: tenantId,
        schemaUrn: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        name: 'Group',
        description: 'Group',
        attributes: GROUP_SCHEMA_ATTRIBUTES,
      },
      {
        endpointId: tenantId,
        schemaUrn: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User',
        name: 'EnterpriseUser',
        description: 'Enterprise User Extension',
        attributes: ENTERPRISE_USER_ATTRIBUTES,
        // ENTERPRISE_USER_ATTRIBUTES per RFC 7643 §4.3:
        // [
        //   { name: 'employeeNumber',  type: 'string',  multiValued: false, required: false, mutability: 'readWrite' },
        //   { name: 'costCenter',       type: 'string',  multiValued: false, required: false, mutability: 'readWrite' },
        //   { name: 'organization',     type: 'string',  multiValued: false, required: false, mutability: 'readWrite' },
        //   { name: 'division',         type: 'string',  multiValued: false, required: false, mutability: 'readWrite' },
        //   { name: 'department',       type: 'string',  multiValued: false, required: false, mutability: 'readWrite' },
        //   { name: 'manager',          type: 'complex', multiValued: false, required: false, mutability: 'readWrite',
        //     subAttributes: [
        //       { name: 'value',       type: 'string',    mutability: 'readWrite' },
        //       { name: '$ref',        type: 'reference', mutability: 'readWrite', referenceTypes: ['User'] },
        //       { name: 'displayName', type: 'string',    mutability: 'readOnly' },
        //     ]
        //   },
        // ]
      },
    ]
  });

  await prisma.tenantResourceType.createMany({
    data: [
      {
        endpointId: tenantId,
        name: 'User',
        endpoint_path: '/Users',
        description: 'User Account',
        baseSchemaUrn: 'urn:ietf:params:scim:schemas:core:2.0:User',
        schemaExtensions: [
          { schema: 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User', required: false }
        ],
      },
      {
        endpointId: tenantId,
        name: 'Group',
        endpoint_path: '/Groups',
        description: 'Group',
        baseSchemaUrn: 'urn:ietf:params:scim:schemas:core:2.0:Group',
        schemaExtensions: [],
      },
    ]
  });
}
```

#### Step 6.3: Rewrite Discovery Controller

```typescript
// endpoint-scim-discovery.controller.ts (AFTER)
@Get('Schemas')
async getSchemas(@Param('endpointId') endpointId: string) {
  const schemas = await this.discoveryService.listSchemas(endpointId);
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: schemas.length,
    startIndex: 1,
    itemsPerPage: schemas.length,
    Resources: schemas,
  };
}

// No more private userSchema() / groupSchema() methods!
```

### Phase 6 — Discovery Request Flow

```mermaid
flowchart TD
    subgraph CURRENT["Current: Hardcoded"]
        C_REQ["GET /Schemas"] --> C_CTRL["DiscoveryController"]
        C_CTRL --> C_PRIV["private userSchema()<br/>private groupSchema()<br/>hardcoded JSON"]
        C_PRIV --> C_RES["Static response<br/>(same for all tenants)"]
    end

    subgraph TARGET["Target: Data-Driven"]
        T_REQ["GET /tenants/:id/Schemas"] --> T_CTRL["DiscoveryController"]
        T_CTRL --> T_SVC["DiscoveryService"]
        T_SVC --> T_REPO["ISchemaRepository"]
        T_REPO --> T_DB[("tenant_schema table<br/>Per-tenant definitions")]
        T_DB --> T_RES["Dynamic response<br/>(per-tenant schemas)"]
    end

    style CURRENT fill:#ffdddd,color:#333
    style TARGET fill:#ddffdd,color:#333
```

#### Step 6.4: Dynamic Extension URN Resolution

```typescript
// BEFORE (scim-patch-path.ts):
const KNOWN_EXTENSION_URNS = ['urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'];

// AFTER (loaded from tenant_schema):
function getExtensionUrns(tenantSchemas: TenantSchema[]): string[] {
  const coreUrns = new Set([
    'urn:ietf:params:scim:schemas:core:2.0:User',
    'urn:ietf:params:scim:schemas:core:2.0:Group',
  ]);
  return tenantSchemas
    .filter(s => !coreUrns.has(s.schemaUrn))
    .map(s => s.schemaUrn);
}
```

> **Historical Reference:** For detailed extension architecture patterns (interface design, hybrid storage model, extension checklist), see `docs/scim-extensions-analysis.md`. For the Three-Pillar compliance framework, per-endpoint isolation audit, dead config flag inventory, and SPC compliance table, see `docs/SCIM_EXTENSIONS_DEEP_ANALYSIS.md` §2A-2C. Both documents are superseded by this plan but retained as supplementary reference.

---

## 9. Phase 7 — ETag & Conditional Requests

### Why?

Currently:
1. **ETag uses timestamp**: `W/"${user.updatedAt.toISOString()}"` — two writes in the same millisecond produce the same ETag (collision).
2. **If-Match is NOT enforced**: `assertIfMatch()` exists in `scim-etag.interceptor.ts` but is **never called** from any service. The interceptor comment says: *"A stricter implementation would check the ETag before applying the write. This interceptor-level check is a best-effort."*
3. **No precondition required mode**: `strictMode` is a config flag but the ETag interceptor doesn't use it.

### Step-by-Step Implementation

#### Step 7.1: Add `version` Column (Already in Phase 2)

```sql
ALTER TABLE scim_resource ADD COLUMN version INT DEFAULT 1;
```

#### Step 7.2: Increment Version on Every Write

```typescript
// In PrismaResourceRepository.update():
async update(id: string, input: ResourceUpdateInput): Promise<ScimResourceModel> {
  const updated = await this.prisma.scimResource.update({
    where: { id },
    data: {
      ...input,
      version: { increment: 1 },  // Atomically increment
    }
  });
  return this.toModel(updated);
}
```

#### Step 7.3: ETag Generation from Version

```typescript
// BEFORE:
version: `W/"${user.updatedAt.toISOString()}"`

// AFTER:
version: `W/"v${resource.version}"`

// Examples: W/"v1", W/"v2", W/"v42"
```

#### Step 7.4: Enforce If-Match in Orchestrator (Before Write)

```typescript
// ResourceOrchestrator.patch()
async patch(tenantId: string, scimId: string, ops: PatchOperation[], ifMatch?: string) {
  const resource = await this.resourceRepo.findById(tenantId, scimId);
  if (!resource) throw createScimError({ status: 404, scimType: 'noTarget' });

  // ← ENFORCE HERE, not in interceptor
  const currentEtag = `W/"v${resource.version}"`;
  
  if (ifMatch && ifMatch !== currentEtag) {
    throw createScimError({
      status: 412,
      scimType: 'mutability',
      detail: `Version mismatch. Current: ${currentEtag}, Provided: ${ifMatch}`
    });
  }

  // If strictMode and no If-Match header → reject
  const config = await this.tenantRepo.getConfig(tenantId);
  if (config.strictMode && !ifMatch) {
    throw createScimError({
      status: 428,
      detail: 'If-Match header is required for PATCH operations in strict mode.'
    });
  }

  // ... apply patch, update
}
```

#### Step 7.5: Simplify Interceptor

```typescript
// scim-etag.interceptor.ts (AFTER — much simpler)
@Injectable()
export class ScimEtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        if (!data || typeof data !== 'object') return data;
        
        const meta = (data as any).meta;
        const etag = meta?.version;
        
        // Set ETag header
        if (etag) res.setHeader('ETag', etag);
        
        // If-None-Match → 304 (GET only)
        if (req.method === 'GET' && etag && req.headers['if-none-match'] === etag) {
          res.status(304);
          return undefined;
        }
        
        // If-Match is handled in the Orchestrator BEFORE the write
        // (not here in the interceptor AFTER the response)
        
        return data;
      }),
    );
  }
}
```

### Before/After Comparison

```
BEFORE (current codebase):
┌─────────────────────────────────────────────────────────────────┐
│ 1. Client sends PATCH with If-Match: W/"2026-02-20T10:00:00Z"  │
│ 2. Controller calls service.patchUser()                         │
│ 3. Service reads user, applies patch, writes update             │
│ 4. Interceptor sees response, reads meta.version                │
│ 5. Interceptor compares If-Match against POST-write version     │
│    ← WRONG! This is the NEW version, not the pre-write version │
│ 6. Even if versions don't match, the write already happened     │
│    ← Lost update problem!                                       │
└─────────────────────────────────────────────────────────────────┘

AFTER (Phase 7):
┌─────────────────────────────────────────────────────────────────┐
│ 1. Client sends PATCH with If-Match: W/"v5"                    │
│ 2. Orchestrator reads resource → version=5                      │
│ 3. Orchestrator compares If-Match W/"v5" == W/"v5" → OK        │
│    (If version was 6 → 412 Precondition Failed, no write)      │
│ 4. PatchEngine applies operations (pure domain logic)           │
│ 5. Repository updates with version: {increment: 1} → v6        │
│ 6. Response has ETag: W/"v6"                                    │
│    ← Correct! Pre-check prevents lost updates.                  │
└─────────────────────────────────────────────────────────────────┘
```

### Phase 7 — Concurrent Write Protection Flow

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant ORCH as Orchestrator
    participant DB as PostgreSQL

    Note over A,DB: Both clients read the same resource (version 5)
    A->>ORCH: GET /Users/abc123
    ORCH->>DB: SELECT ... WHERE scim_id = 'abc123'
    DB-->>ORCH: {version: 5, payload: {...}}
    ORCH-->>A: 200 OK, ETag: W/"v5"

    B->>ORCH: GET /Users/abc123
    ORCH->>DB: SELECT ... WHERE scim_id = 'abc123'
    DB-->>ORCH: {version: 5, payload: {...}}
    ORCH-->>B: 200 OK, ETag: W/"v5"

    Note over A,DB: Client A writes first — succeeds
    A->>ORCH: PATCH /Users/abc123<br/>If-Match: W/"v5"
    ORCH->>DB: SELECT version WHERE scim_id = 'abc123'
    DB-->>ORCH: version = 5
    Note over ORCH: W/"v5" == W/"v5" ✅
    ORCH->>DB: UPDATE ... SET version = 6
    ORCH-->>A: 200 OK, ETag: W/"v6"

    Note over B,DB: Client B writes second — rejected!
    B->>ORCH: PATCH /Users/abc123<br/>If-Match: W/"v5"
    ORCH->>DB: SELECT version WHERE scim_id = 'abc123'
    DB-->>ORCH: version = 6
    Note over ORCH: W/"v5" ≠ W/"v6" ❌
    ORCH-->>B: 412 Precondition Failed

    Note over B: Client B must re-GET, re-apply, retry with W/"v6"
```

---

## 10. Phase 8 — Schema Validation

### Why?

Currently, the server accepts any attributes in a SCIM resource without validation against the tenant's schema definitions. For example, if a client sends `{"schemas": [...], "userName": "john", "favoriteColor": "blue"}`, the server stores `favoriteColor` without any warning or error.

RFC 7643 §2.1 defines attribute characteristics (type, required, mutability, etc.) that SHOULD be enforced on the server side, especially when `strictMode: true`.

### Implementation

```typescript
// src/domain/validation/schema-validator.ts

export class SchemaValidator {
  validate(
    payload: Record<string, unknown>,
    schemaDefinition: SchemaDefinition,
    options: { strictMode: boolean; mode: 'create' | 'replace' | 'patch' }
  ): ValidationResult {
    const errors: ValidationError[] = [];

    // 1. Check required attributes on create/replace
    if (options.mode !== 'patch') {
      for (const attr of schemaDefinition.attributes) {
        if (attr.required && !(attr.name in payload)) {
          errors.push({ path: attr.name, message: `Required attribute '${attr.name}' is missing.` });
        }
      }
    }

    // 2. Check attribute types
    for (const [key, value] of Object.entries(payload)) {
      const attrDef = schemaDefinition.attributes.find(
        a => a.name.toLowerCase() === key.toLowerCase()
      );
      
      if (!attrDef && options.strictMode) {
        errors.push({ path: key, message: `Unknown attribute '${key}' in strict mode.` });
        continue;
      }
      
      if (attrDef) {
        this.validateType(key, value, attrDef, errors);
        this.validateMutability(key, attrDef, options.mode, errors);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}
```

### Phase 8 — Schema Validation Pipeline

```mermaid
flowchart TD
    REQ["POST /Users<br/>or PATCH /Users/:id"] --> ORCH["ResourceOrchestrator"]
    ORCH --> LOAD["Load tenant schema<br/>from tenant_schema table"]
    LOAD --> VALIDATE["SchemaValidator.validate()"]
    
    VALIDATE --> CHK_REQ{"Required attrs<br/>present?"}
    CHK_REQ -->|No| ERR1["400 Required<br/>'userName' is missing"]
    CHK_REQ -->|Yes| CHK_TYPE{"Attribute types<br/>correct?"}
    
    CHK_TYPE -->|No| ERR2["400 Type mismatch<br/>'active' must be boolean"]
    CHK_TYPE -->|Yes| CHK_MUT{"Mutability<br/>respected?"}
    
    CHK_MUT -->|"readOnly attr in write"| ERR3["400 Mutability violation<br/>'id' is readOnly"]
    CHK_MUT -->|Yes| CHK_UNK{"Unknown attrs?<br/>(strictMode)"}
    
    CHK_UNK -->|"strict + unknown"| ERR4["400 Unknown attribute<br/>'favoriteColor'"]
    CHK_UNK -->|"OK or lenient"| PASS["✅ Valid<br/>Continue to write"]

    style ERR1 fill:#ffcdd2,color:#333
    style ERR2 fill:#ffcdd2,color:#333
    style ERR3 fill:#ffcdd2,color:#333
    style ERR4 fill:#ffcdd2,color:#333
    style PASS fill:#c8e6c9,color:#333
```

---

## 11. Phase 9 — Bulk Operations

### Why?

RFC 7644 §3.7 defines Bulk operations for submitting multiple SCIM operations in a single HTTP request. This is critical for large-scale provisioning scenarios (e.g., initial sync of 10,000 users from Entra ID).

The current `ServiceProviderConfig` explicitly says `bulk: { supported: false }`.

### Implementation

```typescript
// src/application/bulk.processor.ts

@Injectable()
export class BulkProcessor {
  constructor(
    private readonly orchestrator: ResourceOrchestrator,
    @Inject('IResourceRepository') private readonly repo: IResourceRepository,
  ) {}

  async process(
    tenantId: string,
    request: BulkRequest,
    baseUrl: string,
  ): Promise<BulkResponse> {
    const bulkIdMap = new Map<string, string>(); // bulkId → resolved SCIM id
    const results: BulkOperationResult[] = [];
    let errorCount = 0;

    for (const op of request.Operations) {
      if (request.failOnErrors > 0 && errorCount >= request.failOnErrors) {
        break;
      }

      try {
        // Resolve bulkId references in the operation
        const resolvedOp = this.resolveBulkIds(op, bulkIdMap);
        
        const result = await this.executeOperation(tenantId, resolvedOp, baseUrl);
        
        // Track bulkId → id mapping for later operations
        if (op.bulkId && result.id) {
          bulkIdMap.set(op.bulkId, result.id);
        }
        
        results.push({ ...result, bulkId: op.bulkId });
      } catch (error) {
        errorCount++;
        results.push({
          method: op.method,
          bulkId: op.bulkId,
          status: error.status || 500,
          response: { detail: error.message },
        });
      }
    }

    return {
      schemas: ['urn:ietf:params:scim:api:messages:2.0:BulkResponse'],
      Operations: results,
    };
  }

  private resolveBulkIds(op: BulkOperation, map: Map<string, string>): BulkOperation {
    // Replace "bulkId:xxx" references with resolved SCIM ids
    const dataStr = JSON.stringify(op.data);
    const resolved = dataStr.replace(/bulkId:([^"]+)/g, (_, id) => {
      const resolved = map.get(id);
      if (!resolved) throw createScimError({ status: 400, detail: `Unresolved bulkId: ${id}` });
      return resolved;
    });
    return { ...op, data: JSON.parse(resolved) };
  }
}
```

### Bulk Request/Response Example

```json
// REQUEST
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "failOnErrors": 3,
  "Operations": [
    {"method": "POST", "path": "/Users", "bulkId": "u1", "data": {"schemas":[...], "userName":"a@b.com"}},
    {"method": "POST", "path": "/Groups", "bulkId": "g1", "data": {"schemas":[...], "displayName":"Team", "members":[{"value":"bulkId:u1"}]}},
    {"method": "PATCH", "path": "/Users/existing-id", "version": "W/\"v5\"", "data": {"schemas":[...], "Operations":[{"op":"replace","path":"active","value":false}]}}
  ]
}

// RESPONSE
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:BulkResponse"],
  "Operations": [
    {"method": "POST", "bulkId": "u1", "status": "201", "location": ".../Users/new-uuid-1"},
    {"method": "POST", "bulkId": "g1", "status": "201", "location": ".../Groups/new-uuid-2"},
    {"method": "PATCH", "status": "200", "location": ".../Users/existing-id"}
  ]
}
```

### Phase 9 — Bulk Processing Pipeline with bulkId Resolution

```mermaid
flowchart TD
    REQ["POST /Bulk<br/>3 Operations"] --> PROC["BulkProcessor"]

    PROC --> OP1["Op 1: POST /Users<br/>bulkId: u1"]
    OP1 --> ORCH1["orchestrator.create()"]
    ORCH1 --> DB1[("INSERT scim_resource<br/>id = new-uuid-1")]
    DB1 --> MAP1["bulkIdMap.set('u1', 'new-uuid-1')"]

    MAP1 --> OP2["Op 2: POST /Groups<br/>bulkId: g1<br/>members: [bulkId:u1]"]
    OP2 --> RESOLVE["resolveBulkIds()<br/>'bulkId:u1' → 'new-uuid-1'"]
    RESOLVE --> ORCH2["orchestrator.create()"]
    ORCH2 --> DB2[("INSERT scim_resource<br/>+ resource_member")]
    DB2 --> MAP2["bulkIdMap.set('g1', 'new-uuid-2')"]

    MAP2 --> OP3["Op 3: PATCH /Users/existing-id<br/>version: W/\"v5\""]
    OP3 --> ORCH3["orchestrator.patch()"]
    ORCH3 --> DB3[("UPDATE scim_resource<br/>version = 6")]

    DB3 --> RES["BulkResponse<br/>3 results"]

    style REQ fill:#e3f2fd,color:#333
    style RES fill:#c8e6c9,color:#333
    style RESOLVE fill:#fff3e0,color:#333
```

---

## 12. Phase 10 — /Me Endpoint

### Why?

RFC 7644 §3.11: "A SCIM service provider MAY support a `/Me` authenticated subject alias".

This maps the currently authenticated user's identity to their SCIM resource. Useful for self-service profile updates.

### Implementation

```typescript
@Controller('endpoints/:endpointId/Me')
export class MeController {
  @Get()
  async getMe(@Req() req: Request) {
    const authContext = req['authContext'];  // Set by AuthGuard
    if (!authContext?.userName) {
      throw createScimError({ status: 501, detail: '/Me requires authenticated user identity mapping.' });
    }
    
    const resource = await this.resourceRepo.findByUserName(
      authContext.tenantId,
      authContext.userName
    );
    
    if (!resource) {
      throw createScimError({ status: 404, detail: 'No resource found for authenticated user.' });
    }
    
    // Return as if GET /Users/{id}
    return this.orchestrator.get(authContext.tenantId, resource.scimId, baseUrl);
  }
}
```

### Phase 10 — /Me Identity Resolution Flow

```mermaid
sequenceDiagram
    participant CLIENT as Authenticated User
    participant GUARD as AuthGuard
    participant ME as MeController
    participant REPO as IResourceRepository
    participant ORCH as ResourceOrchestrator
    participant DB as PostgreSQL

    CLIENT->>GUARD: GET /Me<br/>Authorization: Bearer <token>
    GUARD->>GUARD: Validate token → extract userName
    GUARD-->>ME: req.authContext = {tenantId, userName}

    ME->>REPO: findByUserName(tenantId, userName)
    REPO->>DB: SELECT * FROM scim_resource<br/>WHERE user_name = $1 AND endpoint_id = $2
    DB-->>REPO: ScimResource row
    REPO-->>ME: resource.scimId

    ME->>ORCH: get(tenantId, scimId, baseUrl)
    ORCH-->>ME: Full SCIM User JSON
    ME-->>CLIENT: 200 OK<br/>{id, userName, emails, ...}
```

---

## 13. Phase 11 — Per-Tenant Credentials

### Why?

Currently, `shared-secret.guard.ts` uses a single `SCIM_SHARED_SECRET` environment variable for ALL tenants:

```typescript
// shared-secret.guard.ts (current — line ~60)
const secret = this.configService.get<string>('SCIM_SHARED_SECRET');
```

This means a token valid for Tenant A can access Tenant B's data — a security concern.

### Implementation

#### Step 11.1: Add `tenant_credential` Table

```prisma
model TenantCredential {
  id             String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  endpointId     String   @db.Uuid
  credentialType String   @db.VarChar(50)  // "bearer" | "oauth_client"
  credentialHash String   @db.VarChar(255) // bcrypt hash of token
  metadata       Json?    // {clientId, scopes, ...} for OAuth
  active         Boolean  @default(true)
  createdAt      DateTime @default(now()) @db.Timestamptz
  expiresAt      DateTime? @db.Timestamptz

  endpoint Endpoint @relation(fields: [endpointId], references: [id], onDelete: Cascade)

  @@index([endpointId, active])
}
```

#### Step 11.2: Update Auth Guard

```typescript
// BEFORE:
const secret = this.configService.get<string>('SCIM_SHARED_SECRET');
if (token === secret) return true;

// AFTER:
const tenantId = this.extractTenantId(request);
const credentials = await this.credentialRepo.findActive(tenantId);
for (const cred of credentials) {
  if (await bcrypt.compare(token, cred.credentialHash)) {
    request['authContext'] = { tenantId, credentialId: cred.id };
    return true;
  }
}
throw new UnauthorizedException('Invalid bearer token for this tenant.');
```

#### Step 11.3: Admin Credential Management API

```
POST   /admin/tenants/{id}/credentials   ← Generate new token, return plaintext once
GET    /admin/tenants/{id}/credentials   ← List (hash masked)
DELETE /admin/tenants/{id}/credentials/{credId} ← Revoke
```

### Phase 11 — Authentication Flow (Before vs After)

```mermaid
flowchart TB
    subgraph BEFORE["Current: Global Shared Secret"]
        REQ_B["Any SCIM request<br/>Bearer: abc123"] --> GUARD_B["SharedSecretGuard"]
        GUARD_B -->|"compare with<br/>SCIM_SHARED_SECRET"| CHECK_B{"abc123 == env.secret?"}
        CHECK_B -->|Yes| ACCESS_B["✅ Access ALL tenants"]
        CHECK_B -->|No| DENY_B["❌ 401"]
    end

    subgraph AFTER["After: Per-Tenant Credentials"]
        REQ_A["SCIM request for Tenant X<br/>Bearer: xyz789"] --> GUARD_A["TenantAuthGuard"]
        GUARD_A --> EXTRACT["Extract tenantId<br/>from URL path"]
        EXTRACT --> LOOKUP["credentialRepo.findActive(tenantId)"]
        LOOKUP --> DB_A[("tenant_credential<br/>WHERE endpoint_id = X<br/>AND active = true")]
        DB_A --> BCRYPT{"bcrypt.compare<br/>token vs hash?"}
        BCRYPT -->|Match| ACCESS_A["✅ Access Tenant X only"]
        BCRYPT -->|No match| DENY_A["❌ 401 Invalid token<br/>for this tenant"]
    end

    style BEFORE fill:#fff3e0,color:#333
    style AFTER fill:#e8f5e9,color:#333
    style ACCESS_B fill:#ffcdd2,color:#333
    style ACCESS_A fill:#c8e6c9,color:#333
```

---

## 14. Phase 12 — Sorting, Search, and Cleanup

### Step 12.1: Sorting Support

```typescript
// In ResourceOrchestrator.list():
if (sortBy) {
  const mapped = RESOURCE_DB_COLUMNS[sortBy.toLowerCase()];
  if (mapped) {
    // Push to DB: ORDER BY column (ASC|DESC)
    queryOptions.orderBy = { field: mapped.column, direction: sortOrder || 'ascending' };
  } else {
    // JSONB path: ORDER BY payload->>'attr'
    queryOptions.orderBy = { field: `payload->>'${sortBy}'`, direction: sortOrder || 'ascending' };
  }
}
```

Update ServiceProviderConfig: `sort: { supported: true }`.

### Step 12.2: POST /.search Endpoint

```typescript
@Post(':resourceType/.search')
async search(
  @Param('endpointId') endpointId: string,
  @Body() body: SearchRequest,
) {
  // Same as LIST but parameters from body instead of query string
  return this.orchestrator.list(endpointId, body.resourceType, {
    filter: body.filter,
    sortBy: body.sortBy,
    sortOrder: body.sortOrder,
    startIndex: body.startIndex,
    count: body.count,
    attributes: body.attributes,
    excludedAttributes: body.excludedAttributes,
  });
}
```

### Step 12.3: Remove Deleted/Dead Code

| File | Action | Reason |
|------|--------|--------|
| `endpoint-scim-users.service.ts` | DELETE | Replaced by ResourceOrchestrator |
| `endpoint-scim-groups.service.ts` | DELETE | Replaced by ResourceOrchestrator |
| `endpoint-scim-users.controller.ts` | REFACTOR → ResourceController | Unified controller |
| `endpoint-scim-groups.controller.ts` | REFACTOR → ResourceController | Unified controller |
| `userNameLower` columns | REMOVE | PostgreSQL CITEXT |
| `displayNameLower` columns | REMOVE | PostgreSQL CITEXT |
| `rawPayload String` | REMOVED in Phase 2 | Now `payload Json` |

### Complete SCIM Request Lifecycle (Post-Migration)

```mermaid
sequenceDiagram
    participant IDP as Identity Provider
    participant LB as Container App Ingress
    participant AUTH as TenantAuthGuard
    participant CTRL as ResourceController
    participant ORCH as ResourceOrchestrator
    participant ETAG as ETagService
    participant PATCH as PatchEngine
    participant VALID as SchemaValidator
    participant REPO as PrismaResourceRepository
    participant PG as PostgreSQL 17

    IDP->>LB: POST /tenants/:id/Users<br/>Authorization: Bearer <token>
    LB->>AUTH: Route to Container App

    rect rgb(255, 245, 230)
        Note over AUTH: Authentication
        AUTH->>PG: SELECT * FROM tenant_credential<br/>WHERE endpoint_id = $1 AND active = true
        PG-->>AUTH: credential rows
        AUTH->>AUTH: bcrypt.compare(token, hash)
        Note over AUTH: ✅ Authenticated
    end

    AUTH->>CTRL: Authorized request
    CTRL->>ORCH: create(tenantId, payload, baseUrl)

    rect rgb(230, 245, 255)
        Note over ORCH,VALID: Validation
        ORCH->>PG: SELECT attributes FROM tenant_schema<br/>WHERE endpoint_id = $1 AND schema_urn = $2
        PG-->>ORCH: Schema definition
        ORCH->>VALID: validate(payload, schema, {mode: 'create'})
        VALID-->>ORCH: ✅ Valid
    end

    rect rgb(230, 255, 230)
        Note over ORCH,PG: Persistence
        ORCH->>REPO: assertUnique(tenantId, {userName})
        REPO->>PG: SELECT id FROM scim_resource WHERE user_name = $1 (CITEXT)
        PG-->>REPO: No conflict
        ORCH->>REPO: create({tenantId, type:'User', payload, ...})
        REPO->>PG: INSERT INTO scim_resource ... RETURNING *
        PG-->>REPO: New row (version=1)
    end

    REPO-->>ORCH: ScimResourceModel
    ORCH-->>CTRL: SCIM User JSON
    CTRL-->>LB: 201 Created<br/>ETag: W/"v1"<br/>Location: /Users/:scimId
    LB-->>IDP: 201 Created
```

---

## 15. Risk Matrix & Mitigation

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| **Data loss during PostgreSQL migration** | Low | Critical | Run dual-write for 1 sprint; compare record counts; automated backup before migration |
| **Regression in PATCH behavior** | Medium | High | Comprehensive unit tests for PatchEngine BEFORE extracting code (Phase 5 Step 5.2) |
| **Filter behavior change** | Medium | Medium | Run existing filter tests against both SQLite and PostgreSQL implementations during Phase 4 |
| **ETag format change breaks clients** | Medium | Medium | Phased rollout: accept both old format (`W/"<timestamp>"`) and new (`W/"v<N>"`) for 2 weeks |
| **Downtime during schema migration** | Low | High | Use Prisma `prisma migrate deploy` — typically <1 second for schema changes |
| **Per-tenant credential migration** | Low | Medium | Keep global `SCIM_SHARED_SECRET` as fallback during Phase 11; remove after all tenants migrated |

### Risk Timeline Visualization

```mermaid
flowchart LR
    subgraph P1_2["Phases 1-2<br/>LOW RISK"]
        R1["Additive schema changes"]
        R2["No data loss possible"]
        R3["Rollback: revert code"]
    end

    subgraph P3["Phase 3<br/>HIGHEST RISK"]
        R4["💾 Data migration"]
        R5["⚠️ Schema change"]
        R6["🔄 Rollback: keep SQLite snapshot"]
    end

    subgraph P5_7["Phases 5-7<br/>MEDIUM RISK"]
        R7["PATCH behavior change"]
        R8["ETag format change"]
        R9["Rollback: feature flag"]
    end

    subgraph P8_12["Phases 8-12<br/>LOW RISK"]
        R10["New features only"]
        R11["No existing behavior changes"]
        R12["Rollback: disable feature"]
    end

    P1_2 --> P3 --> P5_7 --> P8_12

    style P1_2 fill:#c8e6c9,color:#333
    style P3 fill:#ffcdd2,color:#333
    style P5_7 fill:#fff9c4,color:#333
    style P8_12 fill:#c8e6c9,color:#333
```

---

## 16. Dependency Graph

```mermaid
graph TD
    P1["Phase 1<br/>Repository Pattern"]
    P2["Phase 2<br/>Unified Resource Table"]
    P3["Phase 3<br/>PostgreSQL Migration"]
    P4["Phase 4<br/>Filter Push-Down"]
    P5["Phase 5<br/>Domain PATCH Engine"]
    P6["Phase 6<br/>Data-Driven Discovery"]
    P7["Phase 7<br/>ETag & Versioning"]
    P8["Phase 8<br/>Schema Validation"]
    P9["Phase 9<br/>Bulk Operations"]
    P10["Phase 10<br/>/Me Endpoint"]
    P11["Phase 11<br/>Per-Tenant Credentials"]
    P12["Phase 12<br/>Sort & Cleanup"]

    P1 --> P2
    P1 --> P5
    P2 --> P3
    P3 --> P4
    P3 --> P6
    P3 --> P7
    P6 --> P8
    P5 --> P9
    P7 --> P9
    P1 --> P10
    P3 --> P11
    P4 --> P12
    P8 --> P12

    style P1 fill:#ff6b6b,color:#fff
    style P2 fill:#ff6b6b,color:#fff
    style P3 fill:#ff6b6b,color:#fff
    style P5 fill:#ff6b6b,color:#fff
    style P4 fill:#feca57,color:#333
    style P6 fill:#feca57,color:#333
    style P7 fill:#feca57,color:#333
    style P8 fill:#48dbfb,color:#333
    style P9 fill:#48dbfb,color:#333
    style P10 fill:#0abde3,color:#fff
    style P11 fill:#0abde3,color:#fff
    style P12 fill:#c8d6e5,color:#333
```

**Legend**: 🔴 Critical path (P1→P2→P3→P5) · 🟡 Important (P4,P6,P7) · 🔵 Feature (P8-P11) · ⚪ Polish (P12)

### Critical Path

```
P1 (Repository) → P2 (Unified Table) → P3 (PostgreSQL) → P5 (PATCH Engine)
```

All other phases can proceed in parallel after their prerequisites are met. For example, P4 (Filter Push-Down) and P6 (Discovery) can be worked simultaneously since both depend only on P3.

---

## 17. Deployment Modes & Per-Phase Impact

The SCIMServer supports four deployment modes. Each migration phase has different impacts depending on the deployment target. This section maps every deployment artifact to the phases that require changes.

### 17.1 Current Deployment Topology

| Mode | Entry Point | Port | Database | Key Files |
|------|------------|------|----------|-----------|
| **Local Dev** | `npm run start:dev` (ts-node-dev) | 3000 | SQLite file `./dev.db` | `api/package.json`, `api/src/main.ts` |
| **Docker Debug** | `docker-compose.debug.yml` | 3000 + 9229 (inspector) | SQLite file (volume-mounted) | `docker-compose.debug.yml` |
| **Docker Production** | Root `Dockerfile` (4-stage) | 8080 | SQLite at `/tmp/local-data/scim.db` | `Dockerfile`, `api/docker-entrypoint.sh` |
| **Azure Container Apps** | Bicep IaC + `deploy.ps1` | 8080 | SQLite + Azure Files backup + Blob snapshots | `infra/*.bicep`, `deploy.ps1`, `setup.ps1` |

### 17.2 Deployment File Inventory

```
Deployment Files
├── Dockerfiles
│   ├── Dockerfile              ← Primary production (4-stage: web→api→deps→runtime)
│   ├── Dockerfile.optimized    ← Aggressive cleanup variant
│   ├── Dockerfile.ultra        ← Parallel build with native addon support
│   ├── api/Dockerfile          ← Simpler 2-stage (build→runtime)
│   └── api/Dockerfile.multi    ← Full deps in runtime (less optimized)
├── Compose
│   └── docker-compose.debug.yml  ← Dev with Node inspector
├── Entrypoint
│   └── api/docker-entrypoint.sh  ← SQLite hybrid storage restore/backup
├── Azure IaC (infra/)
│   ├── containerapp.bicep      ← Container App resource (maxReplicas=1 SQLite constraint)
│   ├── containerapp-env.bicep  ← Log Analytics + VNet-injected environment
│   ├── blob-storage.bicep      ← Blob backup for SQLite snapshots
│   ├── storage.bicep           ← Azure Files share for persistent SQLite
│   ├── networking.bicep        ← VNet + private DNS + 3 subnets
│   └── acr.bicep               ← Azure Container Registry
├── Deploy Scripts
│   ├── deploy.ps1              ← One-click Azure deployment wrapper
│   ├── setup.ps1               ← Azure setup with env overrides
│   └── scripts/deploy-azure.ps1  ← Main deployment logic
└── Application
    ├── api/package.json        ← npm scripts (start, start:dev, build)
    └── api/src/main.ts         ← NestJS bootstrap (PORT, CORS, trust proxy)
```

### 17.3 Current Configuration Details Per Mode

#### Local Dev (`npm run start:dev`)
- **Runtime**: Node 24, ts-node-dev with `--respawn --transpile-only`
- **PORT**: 3000 (default from `main.ts`)
- **DATABASE_URL**: `file:./dev.db` (from `.env` or Prisma default)
- **Secrets**: env vars `SCIM_SHARED_SECRET`, `JWT_SECRET`
- **No container, no Azure Files, no blob backup**
- Build command: `npm run build` → `tsc -p tsconfig.build.json`
- Start command: `npx prisma migrate deploy && node dist/main.js`

#### Docker Debug (`docker-compose.debug.yml`)
- **Image**: `node:24` (full image, not alpine)
- **Command**: `npm ci && npx prisma generate && npm run start:dev`
- **Ports**: `3000:3000` (app) + `9229:9229` (Node inspector)
- **Volume**: `./api` mounted at `/app` (live reload)
- **ENV**: `NODE_ENV=development`
- **No entrypoint.sh, no Azure integration**

#### Docker Production (Root `Dockerfile`)
- **Image**: `node:24-alpine` (4-stage multi-stage build)
- **Stage 1 (web-build)**: React/Vite → `dist/`
- **Stage 2 (api-build)**: NestJS + Prisma generate → `dist/`
- **Stage 3 (prod-deps)**: `npm ci --omit=dev` → stripped `node_modules/`
- **Stage 4 (runtime)**: Non-root user `scim:1001`, PORT=8080
- **Critical**: Deletes PostgreSQL/MySQL/SQL Server WASM query compilers (lines 69-73), keeps **only SQLite**
- **Entrypoint**: `docker-entrypoint.sh` — restores SQLite from Azure Files or blob snapshot, runs `prisma migrate deploy`
- **Health check**: `wget -qO- http://localhost:8080/health`
- **NODE_OPTIONS**: `--max_old_space_size=384`

#### Azure Container Apps (`infra/*.bicep`)
- **Container App** (`containerapp.bicep`):
  - Image from GHCR (public/authenticated) or ACR (managed identity)
  - Secrets: `scim-shared-secret`, `jwt-secret`, `oauth-client-secret`
  - Env: `NODE_ENV=production`, `DATABASE_URL=file:/tmp/local-data/scim.db`
  - **`maxReplicas: 1`** (SQLite single-writer constraint)
  - Startup/Liveness/Readiness probes on `/index.html`
  - SystemAssigned managed identity (ACR pull + blob access)
- **Container Apps Environment** (`containerapp-env.bicep`):
  - Log Analytics workspace (30-day retention)
  - VNet-injected (consumption plan)
- **Networking** (`networking.bicep`):
  - VNet `10.40.0.0/16` with 3 subnets:
    - `aca-infra` (`10.40.0.0/21`) — Container Apps infrastructure
    - `aca-runtime` (`10.40.8.0/21`) — Container Apps workloads
    - `private-endpoints` (`10.40.16.0/24`) — Storage private endpoints
  - Private DNS zone for `privatelink.blob.core.windows.net`
- **Blob Storage** (`blob-storage.bicep`):
  - Storage account + container for SQLite backup snapshots
  - Private endpoint with DNS zone group
- **File Storage** (`storage.bicep`):
  - Azure Files share for persistent SQLite (Standard_LRS, 5 GiB, TLS 1.2)

### 17.4 Per-Phase Deployment Impact Matrix

| Phase | Local Dev | Docker Debug | Docker Production | Azure Container Apps |
|-------|-----------|-------------|-------------------|---------------------|
| **P1 — Repository Pattern** | No change | No change | No change | No change |
| **P2 — Unified Table** | `prisma migrate dev` | Rebuild image | Rebuild image | Rebuild + `prisma migrate deploy` runs on start |
| **P3 — PostgreSQL** | **Major** — new `.env` | **Major** — add postgres service | **Major** — Dockerfile + entrypoint rewrite | **Major** — new Bicep modules, remove blob/files |
| **P4 — Filter Push-Down** | No change | No change | Rebuild image | Rebuild image |
| **P5 — PATCH Engine** | No change | No change | Rebuild image | Rebuild image |
| **P6 — Discovery** | `prisma migrate dev` | Rebuild image | Rebuild image | Rebuild + migration on start |
| **P7 — ETag** | `prisma migrate dev` | Rebuild image | Rebuild image | Rebuild + migration on start |
| **P8 — Schema Validation** | No change | No change | Rebuild image | Rebuild image |
| **P9 — Bulk Operations** | No change | No change | Rebuild image | Rebuild image |
| **P10 — /Me Endpoint** | No change | No change | Rebuild image | Rebuild image |
| **P11 — Per-Tenant Creds** | New env vars | New env vars | New env vars | New secrets in Bicep |
| **P12 — Sort & Cleanup** | No change | No change | Rebuild image | Rebuild image |

### 17.5 Phase 3 — PostgreSQL Migration: Detailed Deployment Changes

Phase 3 is the **only phase that fundamentally transforms the deployment topology**. All other phases require only image rebuilds or prisma migrations. Phase 3 requires changes to every deployment artifact.

#### 17.5.1 Local Dev Changes

```diff
# .env
- DATABASE_URL="file:./dev.db"
+ DATABASE_URL="postgresql://scim:scim@localhost:5432/scimserver?schema=public"
```

- **Add**: Local PostgreSQL instance (Docker or native install)
- **Add**: `docker-compose.dev.yml` with PostgreSQL 17 service for local dev convenience
- **Remove**: `@prisma/adapter-better-sqlite3` and `better-sqlite3` from dependencies
- **Add**: `pg` driver dependency (or use Prisma's built-in PostgreSQL support)
- **prisma/schema.prisma**: Change `provider = "sqlite"` → `provider = "postgresql"`
- **Fresh migration**: `npx prisma migrate dev --name postgresql-initial`

#### 17.5.2 Docker Debug Changes (`docker-compose.debug.yml`)

```diff
+ services:
+   postgres:
+     image: postgres:17-alpine
+     environment:
+       POSTGRES_USER: scim
+       POSTGRES_PASSWORD: scim
+       POSTGRES_DB: scimserver
+     ports:
+       - "5432:5432"
+     volumes:
+       - pgdata:/var/lib/postgresql/data
+     healthcheck:
+       test: ["CMD-SHELL", "pg_isready -U scim"]
+       interval: 5s
+       timeout: 3s
+       retries: 5
+
  scimserver:
    # ...existing config...
    environment:
-     NODE_ENV: development
+     NODE_ENV: development
+     DATABASE_URL: postgresql://scim:scim@postgres:5432/scimserver?schema=public
+   depends_on:
+     postgres:
+       condition: service_healthy
+
+ volumes:
+   pgdata:
```

#### 17.5.3 Docker Production Changes (Root `Dockerfile`)

**File: `Dockerfile`** — Lines 69-73 currently delete PostgreSQL WASM. Must reverse:

```diff
  # Remove unused query-engine WASM binaries to trim ~20 MB
- RUN rm -f node_modules/.prisma/client/query_engine_bg.postgresql.wasm \
-          node_modules/.prisma/client/query_engine_bg.mysql.wasm \
-          node_modules/.prisma/client/query_engine_bg.sqlserver.wasm \
-          node_modules/.prisma/client/query_engine_bg.cockroachdb.wasm
+ RUN rm -f node_modules/.prisma/client/query_engine_bg.sqlite.wasm \
+          node_modules/.prisma/client/query_engine_bg.mysql.wasm \
+          node_modules/.prisma/client/query_engine_bg.sqlserver.wasm \
+          node_modules/.prisma/client/query_engine_bg.cockroachdb.wasm
```

**File: `Dockerfile`** — Runtime environment:

```diff
- ENV DATABASE_URL="file:./data.db"
+ ENV DATABASE_URL=""
# DATABASE_URL now provided at runtime via env var (PostgreSQL connection string)
```

**File: `Dockerfile`** — Remove `better-sqlite3` native addon build (no more python3/make/g++):

```diff
# In Dockerfile.ultra, remove native addon build stage
- RUN apk add --no-cache python3 make g++
```

**File: `api/docker-entrypoint.sh`** — Simplify dramatically (as noted in existing comment on line 13):

```diff
- #!/bin/sh
- # SQLite Hybrid Storage Docker Entrypoint
- # ... (106 lines of Azure Files restore + blob snapshot logic)
+ #!/bin/sh
+ set -e
+ echo "Running Prisma migrations..."
+ npx prisma migrate deploy
+ echo "Starting SCIMServer..."
+ exec node dist/main.js
```

#### 17.5.4 Azure Container Apps Changes (`infra/*.bicep`)

**File: `infra/containerapp.bicep`** — Major changes:

```diff
  # Secrets
  secrets: [
    { name: 'scim-shared-secret', value: sharedSecret }
    { name: 'jwt-secret', value: jwtSecret }
    { name: 'oauth-client-secret', value: oauthClientSecret }
+   { name: 'database-url', value: postgresConnectionString }
  ]

  # Environment variables
- { name: 'DATABASE_URL', value: 'file:/tmp/local-data/scim.db' }
+ { name: 'DATABASE_URL', secretRef: 'database-url' }
- { name: 'BLOB_BACKUP_ACCOUNT', value: blobBackupAccount }
- { name: 'BLOB_BACKUP_CONTAINER', value: blobBackupContainer }

  # Scaling — REMOVE SQLite single-writer constraint
- maxReplicas: 1  // SQLite compromise — single instance only
+ maxReplicas: 3  // PostgreSQL enables horizontal scaling
+ minReplicas: 1

  # Remove volumes (no more Azure Files mount needed)
- volumes: [ { name: 'data', storageType: 'AzureFile', storageName: fileShareName } ]
```

**File: `infra/blob-storage.bicep`** — **DELETE ENTIRELY** (as noted in existing comment):
> "PostgreSQL migration: remove this module — Azure Database for PostgreSQL provides built-in backup with point-in-time recovery."

**File: `infra/storage.bicep`** — **DELETE ENTIRELY** (Azure Files no longer needed for SQLite persistence).

**New File: `infra/postgresql.bicep`** — Add Azure Database for PostgreSQL Flexible Server:

```bicep
// Azure Database for PostgreSQL Flexible Server for SCIMServer
param location string = resourceGroup().location
param serverName string
param administratorLogin string = 'scimadmin'
@secure()
param administratorPassword string
param skuName string = 'Standard_B1ms'         // Burstable, 1 vCore
param skuTier string = 'Burstable'
param storageSizeGB int = 32
param version string = '17'

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: serverName
  location: location
  sku: { name: skuName, tier: skuTier }
  properties: {
    version: version
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorPassword
    storage: { storageSizeGB: storageSizeGB }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
  }
}

resource database 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: postgres
  name: 'scimserver'
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// Allow Azure services (Container Apps) to connect
resource firewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-12-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

output connectionString string = 'postgresql://${administratorLogin}:PASSWORD@${postgres.properties.fullyQualifiedDomainName}:5432/scimserver?schema=public&sslmode=require'
output serverFqdn string = postgres.properties.fullyQualifiedDomainName
```

**Deploy Scripts** (`deploy.ps1`, `setup.ps1`):
- Add `SCIMSERVER_PG_PASSWORD` env var support
- Add PostgreSQL server provisioning step
- Remove blob storage and file share provisioning
- Update `DATABASE_URL` construction to PostgreSQL connection string

### 17.6 Phase 11 — Per-Tenant Credentials: Deployment Changes

#### All Modes
- **New env vars**: `CREDENTIAL_ENCRYPTION_KEY` (for encrypting stored credentials)
- **No structural deployment changes** — same container, same database

#### Azure Container Apps
```diff
  secrets: [
    { name: 'scim-shared-secret', value: sharedSecret }
    { name: 'jwt-secret', value: jwtSecret }
+   { name: 'credential-encryption-key', value: credentialEncryptionKey }
  ]
```

### 17.7 Dockerfile Consolidation Recommendation

Currently 5 Dockerfiles exist. After Phase 3, consolidate to **2**:

| Current | Post-Migration | Rationale |
|---------|---------------|-----------|
| `Dockerfile` (root, 4-stage) | **KEEP** — Primary production build | Becomes simpler without SQLite native addon and WASM pruning changes |
| `Dockerfile.optimized` | **DELETE** — Merge optimizations into primary | Marginal gains vs. maintenance cost |
| `Dockerfile.ultra` | **DELETE** — Native addon builds no longer needed | `better-sqlite3` removed; PostgreSQL uses network driver |
| `api/Dockerfile` | **KEEP** — API-only build for CI/testing | Useful for building API independently |
| `api/Dockerfile.multi` | **DELETE** — Redundant with api/Dockerfile | Less optimized duplicate |

### 17.8 Environment Variable Matrix (Post-Migration)

| Variable | Local Dev | Docker Debug | Docker Prod | Azure Container Apps |
|----------|-----------|-------------|-------------|---------------------|
| `NODE_ENV` | `development` | `development` | `production` | `production` |
| `PORT` | 3000 | 3000 | 8080 | 8080 |
| `DATABASE_URL` | `postgresql://scim:scim@localhost:5432/scimserver` | `postgresql://scim:scim@postgres:5432/scimserver` | Runtime env var (injected) | Secret ref → `database-url` |
| `SCIM_SHARED_SECRET` | `.env` file | docker-compose env | Runtime env var | Secret ref → `scim-shared-secret` |
| `JWT_SECRET` | `.env` file | docker-compose env | Runtime env var | Secret ref → `jwt-secret` |
| `CREDENTIAL_ENCRYPTION_KEY` | `.env` file | docker-compose env | Runtime env var | Secret ref → `credential-encryption-key` |
| `BLOB_BACKUP_ACCOUNT` | N/A | N/A | **REMOVED** | **REMOVED** |
| `BLOB_BACKUP_CONTAINER` | N/A | N/A | **REMOVED** | **REMOVED** |

### 17.9 Deployment Mode Testing Strategy

| Mode | Test Type | Command | Validates |
|------|-----------|---------|-----------|
| Local Dev | Unit + E2E | `npm test && npm run test:e2e` | All application logic |
| Docker Debug | Manual | `docker compose -f docker-compose.debug.yml up` | Hot reload, debugging, PostgreSQL connectivity |
| Docker Prod | Smoke | `docker build -t scim:test . && docker run -p 8080:8080 -e DATABASE_URL=... scim:test` | Production image boots, health check passes |
| Docker Prod | API | `npm run test:smoke` (scripts/live-test.ps1) | Full SCIM CRUD against running container |
| Azure | Integration | `deploy.ps1` + `test:smoke` against Azure URL | End-to-end with managed PostgreSQL, scaling, probes |

### 17.10 Migration Sequence for Azure Deployment

The Azure deployment requires a carefully sequenced cutover during Phase 3:

```
Step 1: Deploy infra/postgresql.bicep (new PostgreSQL server)
Step 2: Run data migration script (SQLite → PostgreSQL)
Step 3: Update containerapp.bicep (new DATABASE_URL, remove blob/files env)
Step 4: Build new Docker image (updated Dockerfile without SQLite WASM)
Step 5: Deploy updated Container App (maxReplicas: 3)
Step 6: Validate with smoke tests against Azure URL
Step 7: Remove infra/blob-storage.bicep deployment
Step 8: Remove infra/storage.bicep deployment
Step 9: Delete Azure Files share + Blob container resources
Step 10: Remove @prisma/adapter-better-sqlite3 from package.json
```

### Azure Cutover Sequence Diagram

```mermaid
sequenceDiagram
    participant DEV as DevOps
    participant BICEP as Bicep IaC
    participant AZ_PG as Azure PostgreSQL
    participant SCRIPT as Migration Script
    participant AZ_BLOB as Azure Blob (SQLite backup)
    participant ACR as Container Registry
    participant ACA as Container App
    participant TESTS as Smoke Tests

    rect rgb(230, 245, 255)
        Note over DEV,AZ_PG: Step 1-2: Provision + Migrate
        DEV->>BICEP: Deploy infra/postgresql.bicep
        BICEP->>AZ_PG: Create Flexible Server (B1ms)
        DEV->>SCRIPT: Run SQLite → PostgreSQL migration
        SCRIPT->>AZ_BLOB: Read SQLite snapshot
        SCRIPT->>AZ_PG: Write to scim_resource table
    end

    rect rgb(255, 250, 230)
        Note over DEV,ACA: Step 3-5: Update + Deploy
        DEV->>BICEP: Update containerapp.bicep<br/>(DATABASE_URL → postgresql://...)
        DEV->>ACR: Build + push new Docker image
        DEV->>ACA: Deploy updated Container App<br/>(maxReplicas: 3)
    end

    rect rgb(230, 255, 230)
        Note over DEV,TESTS: Step 6: Validate
        DEV->>TESTS: pwsh scripts/live-test.ps1 -BaseUrl $AZ_URL
        TESTS->>ACA: Run 280 live tests
        ACA->>AZ_PG: All queries via PostgreSQL
        TESTS-->>DEV: ✅ All passing
    end

    rect rgb(245, 230, 255)
        Note over DEV,AZ_BLOB: Step 7-10: Cleanup
        DEV->>BICEP: Remove blob-storage.bicep
        DEV->>BICEP: Remove storage.bicep
        DEV->>AZ_BLOB: Delete blob container + file share
        DEV->>DEV: Remove better-sqlite3 from package.json
    end
```

### Deployment Topology — Before vs After Phase 3

```mermaid
flowchart TB
    subgraph BEFORE["Current Azure Topology"]
        direction TB
        CA1["Container App<br/>maxReplicas: 1<br/>PORT 8080"]
        EP1["docker-entrypoint.sh<br/>SQLite restore logic"]
        AF1[("Azure Files<br/>scim.db persistent")]
        AB1[("Azure Blob<br/>SQLite snapshots")]
        VN1["VNet + Private Endpoints"]

        CA1 --> EP1
        EP1 -->|"restore"| AF1
        EP1 -->|"fallback restore"| AB1
        AF1 -.-> VN1
        AB1 -.-> VN1
    end

    subgraph AFTER["Post-Migration Azure Topology"]
        direction TB
        CA2["Container App<br/>maxReplicas: 3 ⚡<br/>PORT 8080"]
        EP2["Simplified entrypoint<br/>prisma migrate deploy"]
        PG2[("Azure PostgreSQL<br/>Flexible Server B1ms<br/>Built-in backup")]
        VN2["VNet + Private Endpoint"]

        CA2 --> EP2
        EP2 --> PG2
        PG2 -.-> VN2
    end

    BEFORE ===>|"Phase 3"| AFTER

    style BEFORE fill:#fff3e0,color:#333
    style AFTER fill:#e8f5e9,color:#333
```

**Rollback plan**: Keep SQLite blob snapshot for 1 sprint after cutover. If PostgreSQL issues arise, revert `DATABASE_URL` to `file:` path and redeploy with old Dockerfile.

---

## Summary: Current → Ideal Mapping

| Current Component | Ideal Replacement | Phase |
|------------------|------------------|-------|
| `prisma.scimUser.create(...)` (direct) | `resourceRepo.create(input)` (interface) | 1 |
| `ScimUser` + `ScimGroup` tables | `scim_resource` unified table | 2 |
| SQLite with `better-sqlite3` | PostgreSQL 17 with CITEXT, JSONB, GIN | 3 |
| `tryPushToDb()` → eq only | Full operator push-down | 4 |
| 200-line inline PATCH in service | Pure `PatchEngine` class in Domain | 5 |
| Hardcoded `userSchema()` / `groupSchema()` | `tenant_schema` + `tenant_resource_type` DB rows | 6 |
| `W/"${updatedAt.toISOString()}"` | `W/"v${version}"` monotonic integer | 7 |
| `assertIfMatch()` exists but never called | `orchestrator.assertIfMatch()` before every write | 7 |
| No schema validation | `SchemaValidator` with strictMode | 8 |
| `bulk: {supported: false}` | `BulkProcessor` with bulkId resolution | 9 |
| No /Me | `MeController` | 10 |
| Single `SCIM_SHARED_SECRET` | `tenant_credential` with bcrypt hashes | 11 |
| `sort: {supported: false}` | `SortEngine` + DB push-down | 12 |
