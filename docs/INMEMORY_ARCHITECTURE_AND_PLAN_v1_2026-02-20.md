# In-Memory Repository Architecture & Migration Plan

> **Version**: 1.0 · **Date**: 2026-02-20
> **Companion documents**: `IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md` (PostgreSQL) · `MIGRATION_PLAN_CURRENT_TO_IDEAL_v3_2026-02-20.md`
> **Scope**: In-memory `Map`-based repository implementation that fulfills the same `IResourceRepository` interface as the PostgreSQL path — for testing, dev, demo, and lightweight deployments.

---

## Table of Contents

1. [Executive Summary — Why In-Memory?](#1-executive-summary--why-in-memory)
2. [PostgreSQL vs In-Memory Comparison Matrix](#2-postgresql-vs-in-memory-comparison-matrix)
3. [Architecture Overview](#3-architecture-overview)
4. [Data Model (In-Memory Stores)](#4-data-model-in-memory-stores)
5. [Repository Implementations](#5-repository-implementations)
6. [Filter, Sort & Pagination (All In-Memory)](#6-filter-sort--pagination-all-in-memory)
7. [ETag, Versioning & Concurrency](#7-etag-versioning--concurrency)
8. [Persistence Snapshots (Optional)](#8-persistence-snapshots-optional)
9. [Trade-offs & Limitations](#9-trade-offs--limitations)
10. [Deployment Modes](#10-deployment-modes)
11. [Migration Plan — Current → In-Memory](#11-migration-plan--current--in-memory)
12. [Migration Phase Details](#12-migration-phase-details)
13. [Testing Strategy](#13-testing-strategy)
14. [Decision Framework — When to Use Which](#14-decision-framework--when-to-use-which)
15. [Appendix A — Mermaid Diagrams](#15-appendix-a--mermaid-diagrams)
16. [Appendix B — Comparative Code Examples](#16-appendix-b--comparative-code-examples)

---

## 1. Executive Summary — Why In-Memory?

The ideal architecture (see `IDEAL_SCIM_ARCHITECTURE_v3_2026-02-20.md`) defines **Persistence Agnosticism** as Design Principle P4:

> *"Domain logic depends only on Repository interfaces. PostgreSQL, SQLite, or DynamoDB can be swapped without touching business rules."*

An in-memory repository implementation fulfills several critical needs:

| Need | How In-Memory Serves It |
|------|-------------------------|
| **Unit Testing** | Tests run in <5ms per suite — no database startup, no migrations, no teardown |
| **Integration Testing** | Full SCIM request pipeline testable without Docker Compose or PostgreSQL |
| **Demo/POC** | Zero-dependency `npx scimserver` experience — no database to provision |
| **Development** | Instant restarts, no migration drift, full feature parity for SCIM logic |
| **CI/CD** | GitHub Actions pipelines run without `services: postgres` container |
| **Edge/Embedded** | Deploy as sidecar or serverless function with no external dependencies |

### What It Is NOT

- **Not a replacement for PostgreSQL in production** — data is lost on process restart (unless snapshot persistence is enabled)
- **Not a performance optimization** — in-memory filtering is O(n) vs PostgreSQL's O(log n) with indexes
- **Not a scaling solution** — single-process, single-instance by definition

---

## 2. PostgreSQL vs In-Memory Comparison Matrix

### Feature Parity

| Feature | PostgreSQL | In-Memory | Notes |
|---------|-----------|-----------|-------|
| **SCIM CRUD (Users/Groups)** | ✅ Full | ✅ Full | Same `IResourceRepository` interface |
| **SCIM PATCH (all ops)** | ✅ Full | ✅ Full | PatchEngine is pure domain — persistence-agnostic |
| **Filter: `eq` operator** | ✅ DB index | ✅ `Map.get()` O(1) | In-memory is actually faster for eq on indexed fields |
| **Filter: `co`/`sw`/`ew`** | ✅ pg_trgm GIN | ✅ `String.includes/startsWith/endsWith` | In-memory is O(n) scan; PostgreSQL uses GIN index |
| **Filter: JSONB path** | ✅ `payload @>` | ✅ Deep object traversal | In-memory navigates JS objects directly |
| **Filter: `AND`/`OR`/`NOT`** | ✅ SQL compound | ✅ Logical operators | Both fully supported |
| **Sort** | ✅ `ORDER BY` | ✅ `Array.sort()` | In-memory sorts full result set |
| **Pagination** | ✅ `OFFSET`+`LIMIT` | ✅ `Array.slice()` | In-memory slices sorted array |
| **ETag (version)** | ✅ `version INT` column | ✅ `version` property on stored object | Same `W/"v{N}"` format |
| **If-Match / If-None-Match** | ✅ Full | ✅ Full | Domain-layer logic, not persistence-dependent |
| **Bulk Operations** | ✅ Transaction | ✅ Sequential (no rollback) | In-memory has no true transaction semantics |
| **Multi-Tenancy** | ✅ `tenant_id` FK | ✅ `Map<tenantId, Map<scimId, Resource>>` | Isolated by nested Map keys |
| **Data-Driven Discovery** | ✅ `tenant_schema` table | ✅ `Map<tenantId, Schema[]>` | Same interface, different storage |
| **Per-Tenant Credentials** | ✅ `tenant_credential` table | ✅ `Map<tenantId, Credential[]>` | Same bcrypt comparison |
| **Case-Insensitive Search** | ✅ CITEXT | ✅ `toLowerCase()` comparison | Explicit case folding in memory |
| **Unique Constraints** | ✅ Partial unique index | ✅ Secondary index Maps | Must be manually enforced |

### Performance Characteristics

| Operation | PostgreSQL (10K resources) | In-Memory (10K resources) | In-Memory (100K resources) |
|-----------|--------------------------|--------------------------|---------------------------|
| `GET /Users/{id}` | ~2ms (PK lookup) | ~0.01ms (Map.get) | ~0.01ms |
| `GET /Users?filter=userName eq "x"` | ~2ms (CITEXT index) | ~0.01ms (secondary index) | ~0.01ms |
| `GET /Users?filter=userName co "x"` | ~3ms (pg_trgm GIN) | ~5ms (full scan) | ~50ms |
| `GET /Users?filter=emails.value eq "x"` | ~3ms (JSONB GIN) | ~10ms (deep scan) | ~100ms |
| `GET /Users` (list all, paginated) | ~5ms | ~2ms | ~15ms |
| `POST /Users` (create) | ~3ms (INSERT + index) | ~0.05ms (Map.set) | ~0.05ms |
| `PATCH /Users/{id}` | ~5ms (SELECT + UPDATE) | ~0.1ms (get + set) | ~0.1ms |
| `DELETE /Users/{id}` | ~2ms (DELETE) | ~0.05ms (Map.delete) | ~0.05ms |
| **Memory at rest** | ~0 (on disk) | ~50 MB | ~500 MB |
| **Startup time** | ~2s (connection pool) | ~10ms | ~10ms |
| **Data durability** | ✅ WAL + backup | ❌ Lost on restart | ❌ Lost on restart |

### Operational Characteristics

| Concern | PostgreSQL | In-Memory |
|---------|-----------|-----------|
| **External dependency** | PostgreSQL server required | None |
| **Horizontal scaling** | ✅ Multiple replicas, shared DB | ❌ Each instance has own data |
| **Data persistence** | ✅ Survives restarts/crashes | ❌ Lost (unless snapshot enabled) |
| **Backup & recovery** | ✅ pg_dump, Azure Backup, PITR | ⚠️ JSON snapshot to file (manual) |
| **Concurrent writes** | ✅ Row-level locks, MVCC | ⚠️ Single-threaded Node.js (safe but sequential) |
| **Schema migrations** | ✅ Prisma Migrate | N/A — no schema to migrate |
| **Connection limit** | Configurable pool | N/A |
| **Cold start** | ~2-3s (pool warmup) | ~10ms |
| **Docker image size** | Same (Prisma client bundled) | Smaller (no Prisma, no query engines) |
| **Infrastructure cost** | PostgreSQL server ($5-50/mo) | $0 additional |

---

## 3. Architecture Overview

The key insight: the **in-memory implementation sits entirely in the Infrastructure layer**. All layers above it — Domain, Application, Presentation — are completely unchanged.

```
┌─────────────────────────────────────────────────────────────────┐
│ PRESENTATION LAYER                                               │
│  Controllers · Guards · Interceptors · Pipes · Exception Filter  │
│              ← IDENTICAL for both PostgreSQL and In-Memory →     │
├─────────────────────────────────────────────────────────────────┤
│ APPLICATION LAYER                                                │
│  TenantResolver · ResourceOrchestrator · BulkProcessor           │
│              ← IDENTICAL for both PostgreSQL and In-Memory →     │
├─────────────────────────────────────────────────────────────────┤
│ DOMAIN LAYER (no framework imports)                              │
│  PatchEngine · FilterPlanner · SchemaValidator · MetaBuilder     │
│              ← IDENTICAL for both PostgreSQL and In-Memory →     │
├─────────────────────────────────────────────────────────────────┤
│ DATA ACCESS LAYER — Repository Interfaces (Ports)                │
│  IResourceRepository · ITenantRepository · ISchemaRepository     │
│              ← IDENTICAL interface for both implementations →    │
├──────────────────────┬──────────────────────────────────────────┤
│ INFRASTRUCTURE       │ INFRASTRUCTURE                            │
│ (PostgreSQL)         │ (In-Memory)                               │
│                      │                                           │
│ PrismaResource-      │ InMemoryResource-                        │
│   Repository         │   Repository                              │
│ PrismaTenant-        │ InMemoryTenant-                           │
│   Repository         │   Repository                              │
│ PrismaSchema-        │ InMemorySchema-                           │
│   Repository         │   Repository                              │
│ PrismaMembership-    │ InMemoryMembership-                       │
│   Repository         │   Repository                              │
│ PrismaCredential-    │ InMemoryCredential-                       │
│   Repository         │   Repository                              │
│                      │                                           │
│ Depends on:          │ Depends on:                               │
│ - @prisma/client     │ - Nothing (pure TypeScript)               │
│ - PostgreSQL server  │                                           │
└──────────────────────┴──────────────────────────────────────────┘
```

### Architecture Diagram

```mermaid
flowchart TB
    subgraph SHARED["Shared Layers (100% identical)"]
        direction TB
        CTRL["Presentation<br/>Controllers · Guards · Interceptors"]
        APP["Application<br/>ResourceOrchestrator · BulkProcessor"]
        DOM["Domain<br/>PatchEngine · SchemaValidator · FilterPlanner"]
        PORT["Ports<br/>IResourceRepository · ITenantRepository<br/>ISchemaRepository · IMembershipRepository"]

        CTRL --> APP --> DOM --> PORT
    end

    subgraph PG_IMPL["PostgreSQL Implementation"]
        PG_REPO["PrismaResourceRepository<br/>PrismaTenantRepository<br/>PrismaSchemaRepository"]
        PG_DB[("PostgreSQL 17<br/>JSONB · CITEXT · GIN")]
        PG_REPO --> PG_DB
    end

    subgraph MEM_IMPL["In-Memory Implementation"]
        MEM_REPO["InMemoryResourceRepository<br/>InMemoryTenantRepository<br/>InMemorySchemaRepository"]
        MEM_STORE[("Map&lt;string, Map&gt;<br/>JS Objects in heap")]
        MEM_REPO --> MEM_STORE
    end

    PORT -->|"inject"| PG_REPO
    PORT -->|"inject"| MEM_REPO

    style SHARED fill:#e3f2fd,color:#333
    style PG_IMPL fill:#e8f5e9,color:#333
    style MEM_IMPL fill:#fff3e0,color:#333
```

### Module Wiring (NestJS)

```typescript
// src/modules/persistence/persistence.module.ts

@Module({})
export class PersistenceModule {
  static forRoot(driver: 'postgresql' | 'memory'): DynamicModule {
    const providers =
      driver === 'memory'
        ? [
            { provide: 'IResourceRepository', useClass: InMemoryResourceRepository },
            { provide: 'ITenantRepository', useClass: InMemoryTenantRepository },
            { provide: 'ISchemaRepository', useClass: InMemorySchemaRepository },
            { provide: 'IMembershipRepository', useClass: InMemoryMembershipRepository },
            { provide: 'ICredentialRepository', useClass: InMemoryCredentialRepository },
          ]
        : [
            { provide: 'IResourceRepository', useClass: PrismaResourceRepository },
            { provide: 'ITenantRepository', useClass: PrismaTenantRepository },
            { provide: 'ISchemaRepository', useClass: PrismaSchemaRepository },
            { provide: 'IMembershipRepository', useClass: PrismaMembershipRepository },
            { provide: 'ICredentialRepository', useClass: PrismaCredentialRepository },
          ];

    return {
      module: PersistenceModule,
      providers,
      exports: providers.map(p => p.provide),
      global: true,
    };
  }
}

// src/app.module.ts
@Module({
  imports: [
    PersistenceModule.forRoot(
      process.env.DB_DRIVER === 'memory' ? 'memory' : 'postgresql'
    ),
    // ... other modules unchanged
  ],
})
export class AppModule {}
```

---

## 4. Data Model (In-Memory Stores)

### Store Structure

```typescript
// src/infrastructure/persistence/memory/stores.ts

/**
 * Central in-memory data store.
 * All Maps are organized: tenantId → resourceId → resource
 * to provide O(1) lookup and natural tenant isolation.
 */
export class InMemoryStore {
  // ── Core Resources ──────────────────────────────────────────
  /** tenantId → scimId → ScimResourceModel */
  readonly resources = new Map<string, Map<string, ScimResourceModel>>();

  // ── Secondary Indexes (for O(1) lookups on unique fields) ──
  /** tenantId → userNameLower → scimId */
  readonly userNameIndex = new Map<string, Map<string, string>>();
  /** tenantId → externalId → scimId */
  readonly externalIdIndex = new Map<string, Map<string, string>>();

  // ── Membership ──────────────────────────────────────────────
  /** groupScimId → Set<memberScimId> (with display/type metadata) */
  readonly members = new Map<string, Map<string, MemberEntry>>();

  // ── Tenant Config ───────────────────────────────────────────
  /** tenantId → TenantModel */
  readonly tenants = new Map<string, TenantModel>();

  // ── Schema / ResourceType Discovery ─────────────────────────
  /** tenantId → SchemaModel[] */
  readonly schemas = new Map<string, SchemaModel[]>();
  /** tenantId → ResourceTypeModel[] */
  readonly resourceTypes = new Map<string, ResourceTypeModel[]>();

  // ── Credentials ─────────────────────────────────────────────
  /** tenantId → CredentialModel[] */
  readonly credentials = new Map<string, CredentialModel[]>();

  // ── Auto-increment counters ─────────────────────────────────
  private _idCounter = 0;
  generateId(): string {
    return `mem-${(++this._idCounter).toString(36).padStart(8, '0')}`;
  }

  // ── Reset (for testing) ─────────────────────────────────────
  clear(): void {
    this.resources.clear();
    this.userNameIndex.clear();
    this.externalIdIndex.clear();
    this.members.clear();
    this.tenants.clear();
    this.schemas.clear();
    this.resourceTypes.clear();
    this.credentials.clear();
    this._idCounter = 0;
  }
}

export interface MemberEntry {
  value: string;       // SCIM id of member
  display?: string;
  type?: string;
}
```

### Store Visualization

```mermaid
erDiagram
    InMemoryStore ||--o{ ResourceMap : "resources"
    InMemoryStore ||--o{ TenantMap : "tenants"
    InMemoryStore ||--o{ SchemaList : "schemas"
    InMemoryStore ||--o{ CredentialList : "credentials"
    InMemoryStore ||--o{ MemberMap : "members"
    InMemoryStore ||--o{ UserNameIndex : "userNameIndex"
    InMemoryStore ||--o{ ExternalIdIndex : "externalIdIndex"

    ResourceMap {
        string tenantId PK
        Map scimId_to_Resource "Map<scimId, ScimResourceModel>"
    }

    TenantMap {
        string tenantId PK
        TenantModel config "name, displayName, config JSONB"
    }

    SchemaList {
        string tenantId PK
        SchemaModel[] schemas "schemaUrn, name, attributes"
    }

    CredentialList {
        string tenantId PK
        CredentialModel[] creds "type, hash, active, expiresAt"
    }

    MemberMap {
        string groupScimId PK
        Map member_entries "Map<memberScimId, MemberEntry>"
    }

    UserNameIndex {
        string tenantId PK
        Map userName_to_scimId "case-folded userName → scimId"
    }

    ExternalIdIndex {
        string tenantId PK
        Map externalId_to_scimId "externalId → scimId"
    }
```

### Comparison: PostgreSQL Tables vs In-Memory Maps

| PostgreSQL Table | In-Memory Equivalent | Indexing |
|-----------------|---------------------|----------|
| `scim_resource` | `resources: Map<tenantId, Map<scimId, Model>>` | Primary: `Map.get(scimId)` O(1) |
| `UNIQUE(tenant_id, user_name)` CITEXT index | `userNameIndex: Map<tenantId, Map<lower(userName), scimId>>` | Secondary: `Map.get(lower(name))` O(1) |
| `UNIQUE(tenant_id, external_id)` partial index | `externalIdIndex: Map<tenantId, Map<externalId, scimId>>` | Secondary: `Map.get(externalId)` O(1) |
| `resource_member` | `members: Map<groupScimId, Map<memberScimId, Entry>>` | Group lookup: `Map.get(groupId)` O(1) |
| `tenant` | `tenants: Map<tenantId, TenantModel>` | Direct: `Map.get(tenantId)` O(1) |
| `tenant_schema` | `schemas: Map<tenantId, SchemaModel[]>` | Linear scan within tenant's schemas |
| `tenant_resource_type` | `resourceTypes: Map<tenantId, ResourceTypeModel[]>` | Linear scan within tenant's types |
| `tenant_credential` | `credentials: Map<tenantId, CredentialModel[]>` | Linear scan within tenant's credentials |
| GIN index on `payload JSONB` | No index — full scan + deep object traversal | O(n) per query |
| pg_trgm GIN for `co`/`sw`/`ew` | No index — `String.includes/startsWith/endsWith` | O(n) per query |

---

## 5. Repository Implementations

### InMemoryResourceRepository

```typescript
// src/infrastructure/persistence/memory/in-memory-resource.repository.ts

@Injectable()
export class InMemoryResourceRepository implements IResourceRepository {
  constructor(private readonly store: InMemoryStore) {}

  async create(input: ResourceCreateInput): Promise<ScimResourceModel> {
    // 1. Generate IDs
    const id = this.store.generateId();
    const scimId = input.scimId ?? crypto.randomUUID();
    const now = new Date();

    // 2. Build model
    const model: ScimResourceModel = {
      id,
      tenantId: input.tenantId,
      resourceType: input.resourceType,
      scimId,
      externalId: input.externalId ?? null,
      userName: input.userName ?? null,
      displayName: input.displayName ?? null,
      active: input.active ?? true,
      payload: input.payload,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    // 3. Ensure tenant map exists
    if (!this.store.resources.has(input.tenantId)) {
      this.store.resources.set(input.tenantId, new Map());
      this.store.userNameIndex.set(input.tenantId, new Map());
      this.store.externalIdIndex.set(input.tenantId, new Map());
    }

    // 4. Store resource
    this.store.resources.get(input.tenantId)!.set(scimId, model);

    // 5. Update secondary indexes
    if (model.userName) {
      this.store.userNameIndex.get(input.tenantId)!.set(
        model.userName.toLowerCase(), scimId
      );
    }
    if (model.externalId) {
      this.store.externalIdIndex.get(input.tenantId)!.set(
        model.externalId, scimId
      );
    }

    return model;
  }

  async findById(tenantId: string, scimId: string): Promise<ScimResourceModel | null> {
    return this.store.resources.get(tenantId)?.get(scimId) ?? null;
  }

  async findByUserName(tenantId: string, userName: string): Promise<ScimResourceModel | null> {
    const scimId = this.store.userNameIndex.get(tenantId)?.get(userName.toLowerCase());
    if (!scimId) return null;
    return this.findById(tenantId, scimId);
  }

  async findByExternalId(tenantId: string, externalId: string): Promise<ScimResourceModel | null> {
    const scimId = this.store.externalIdIndex.get(tenantId)?.get(externalId);
    if (!scimId) return null;
    return this.findById(tenantId, scimId);
  }

  async query(options: ResourceQueryOptions): Promise<ResourceQueryResult<ScimResourceModel>> {
    const tenantMap = this.store.resources.get(options.tenantId);
    if (!tenantMap) return { items: [], totalCount: 0 };

    // 1. Collect all resources of the requested type
    let results = Array.from(tenantMap.values())
      .filter(r => r.resourceType === options.resourceType);

    // 2. Apply filter (in-memory evaluation)
    if (options.where) {
      results = results.filter(r => this.matchesFilter(r, options.where!));
    }

    const totalCount = results.length;

    // 3. Sort
    if (options.orderBy) {
      results = this.sortResults(results, options.orderBy);
    }

    // 4. Paginate
    const offset = options.offset ?? 0;
    const limit = options.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return { items: results, totalCount };
  }

  async update(id: string, input: ResourceUpdateInput): Promise<ScimResourceModel> {
    // Find the resource by internal id across all tenants
    for (const [tenantId, tenantMap] of this.store.resources) {
      for (const [scimId, resource] of tenantMap) {
        if (resource.id === id) {
          // Update secondary indexes if userName changed
          if (input.userName !== undefined && input.userName !== resource.userName) {
            const idx = this.store.userNameIndex.get(tenantId)!;
            if (resource.userName) idx.delete(resource.userName.toLowerCase());
            if (input.userName) idx.set(input.userName.toLowerCase(), scimId);
          }
          if (input.externalId !== undefined && input.externalId !== resource.externalId) {
            const idx = this.store.externalIdIndex.get(tenantId)!;
            if (resource.externalId) idx.delete(resource.externalId);
            if (input.externalId) idx.set(input.externalId, scimId);
          }

          // Merge updates
          const updated: ScimResourceModel = {
            ...resource,
            ...input,
            version: (input.version ?? resource.version) + 1,
            updatedAt: new Date(),
          };
          tenantMap.set(scimId, updated);
          return updated;
        }
      }
    }
    throw new Error(`Resource not found: ${id}`);
  }

  async delete(id: string): Promise<void> {
    for (const [tenantId, tenantMap] of this.store.resources) {
      for (const [scimId, resource] of tenantMap) {
        if (resource.id === id) {
          // Clean up secondary indexes
          if (resource.userName) {
            this.store.userNameIndex.get(tenantId)?.delete(resource.userName.toLowerCase());
          }
          if (resource.externalId) {
            this.store.externalIdIndex.get(tenantId)?.delete(resource.externalId);
          }
          tenantMap.delete(scimId);
          // Clean up memberships
          this.store.members.delete(scimId);
          for (const [, memberMap] of this.store.members) {
            memberMap.delete(scimId);
          }
          return;
        }
      }
    }
  }

  async assertUnique(
    tenantId: string,
    userName?: string,
    externalId?: string,
    excludeScimId?: string,
  ): Promise<void> {
    if (userName) {
      const existingScimId = this.store.userNameIndex.get(tenantId)?.get(userName.toLowerCase());
      if (existingScimId && existingScimId !== excludeScimId) {
        throw createScimError({ status: 409, detail: `userName '${userName}' already exists.` });
      }
    }
    if (externalId) {
      const existingScimId = this.store.externalIdIndex.get(tenantId)?.get(externalId);
      if (existingScimId && existingScimId !== excludeScimId) {
        throw createScimError({ status: 409, detail: `externalId '${externalId}' already exists.` });
      }
    }
  }

  // ── Private helpers ─────────────────────────────────────────

  private matchesFilter(resource: ScimResourceModel, where: Record<string, unknown>): boolean {
    // Delegate to the in-memory filter evaluator
    // This uses the same evaluateFilter() function currently used for non-pushable filters
    return evaluateFilter(resource.payload, where);
  }

  private sortResults(
    results: ScimResourceModel[],
    orderBy: { field: string; direction: 'asc' | 'desc' },
  ): ScimResourceModel[] {
    return results.sort((a, b) => {
      const valA = this.extractSortValue(a, orderBy.field);
      const valB = this.extractSortValue(b, orderBy.field);
      const cmp = String(valA ?? '').localeCompare(String(valB ?? ''));
      return orderBy.direction === 'desc' ? -cmp : cmp;
    });
  }

  private extractSortValue(resource: ScimResourceModel, field: string): unknown {
    // Map known first-class fields
    const fieldMap: Record<string, keyof ScimResourceModel> = {
      username: 'userName', displayname: 'displayName',
      externalid: 'externalId', active: 'active',
      id: 'scimId', 'meta.created': 'createdAt', 'meta.lastmodified': 'updatedAt',
    };
    const mapped = fieldMap[field.toLowerCase()];
    if (mapped) return resource[mapped];
    // Deep extract from payload
    return field.split('.').reduce((obj: any, key) => obj?.[key], resource.payload);
  }
}
```

### InMemoryMembershipRepository

```typescript
@Injectable()
export class InMemoryMembershipRepository implements IMembershipRepository {
  constructor(private readonly store: InMemoryStore) {}

  async addMembers(groupScimId: string, members: MemberEntry[]): Promise<void> {
    if (!this.store.members.has(groupScimId)) {
      this.store.members.set(groupScimId, new Map());
    }
    const group = this.store.members.get(groupScimId)!;
    for (const m of members) {
      group.set(m.value, m);
    }
  }

  async removeMembers(groupScimId: string, memberIds: string[]): Promise<void> {
    const group = this.store.members.get(groupScimId);
    if (!group) return;
    for (const id of memberIds) {
      group.delete(id);
    }
  }

  async getMembers(groupScimId: string): Promise<MemberEntry[]> {
    const group = this.store.members.get(groupScimId);
    return group ? Array.from(group.values()) : [];
  }

  async replaceMembers(groupScimId: string, members: MemberEntry[]): Promise<void> {
    this.store.members.set(groupScimId, new Map(members.map(m => [m.value, m])));
  }
}
```

### InMemoryTenantRepository

```typescript
@Injectable()
export class InMemoryTenantRepository implements ITenantRepository {
  constructor(private readonly store: InMemoryStore) {}

  async findById(tenantId: string): Promise<TenantModel | null> {
    return this.store.tenants.get(tenantId) ?? null;
  }

  async findByName(name: string): Promise<TenantModel | null> {
    for (const tenant of this.store.tenants.values()) {
      if (tenant.name === name) return tenant;
    }
    return null;
  }

  async create(input: TenantCreateInput): Promise<TenantModel> {
    const id = this.store.generateId();
    const tenant: TenantModel = {
      id, name: input.name, displayName: input.displayName ?? null,
      config: input.config ?? {}, active: true,
      createdAt: new Date(), updatedAt: new Date(),
    };
    this.store.tenants.set(id, tenant);
    return tenant;
  }

  async getConfig(tenantId: string): Promise<Record<string, unknown>> {
    return this.store.tenants.get(tenantId)?.config ?? {};
  }
}
```

---

## 6. Filter, Sort & Pagination (All In-Memory)

### Filter Processing Comparison

```mermaid
flowchart TD
    subgraph PG["PostgreSQL Path"]
        PG_PARSE["FilterParser<br/>→ AST"] --> PG_PLAN["FilterPlanner<br/>→ SQL WHERE"]
        PG_PLAN --> PG_DB[("PostgreSQL<br/>Indexed query")]
        PG_DB --> PG_RESULT["Filtered results<br/>from DB"]
    end

    subgraph MEM["In-Memory Path"]
        MEM_PARSE["FilterParser<br/>→ AST"] --> MEM_PLAN["FilterPlanner<br/>→ evaluateFilter()"]
        MEM_PLAN --> MEM_SCAN["Array.filter()<br/>Full collection scan"]
        MEM_SCAN --> MEM_RESULT["Filtered results<br/>from memory"]
    end

    REQ["SCIM Filter Request"] --> PG_PARSE
    REQ --> MEM_PARSE

    style PG fill:#e8f5e9,color:#333
    style MEM fill:#fff3e0,color:#333
```

### Filter Operator Implementation Matrix

| SCIM Operator | PostgreSQL SQL | In-Memory JavaScript |
|--------------|---------------|---------------------|
| `eq` | `WHERE user_name = $1` (CITEXT) | `val?.toLowerCase() === target.toLowerCase()` |
| `ne` | `WHERE user_name != $1` | `val?.toLowerCase() !== target.toLowerCase()` |
| `co` | `WHERE user_name ILIKE '%x%'` (pg_trgm) | `val?.toLowerCase().includes(target.toLowerCase())` |
| `sw` | `WHERE user_name ILIKE 'x%'` | `val?.toLowerCase().startsWith(target.toLowerCase())` |
| `ew` | `WHERE user_name ILIKE '%x'` | `val?.toLowerCase().endsWith(target.toLowerCase())` |
| `gt` | `WHERE version > $1` | `val > target` |
| `ge` | `WHERE version >= $1` | `val >= target` |
| `lt` | `WHERE version < $1` | `val < target` |
| `le` | `WHERE version <= $1` | `val <= target` |
| `pr` | `WHERE user_name IS NOT NULL` | `val !== undefined && val !== null` |
| JSONB path `emails.value eq` | `payload @> '{"emails":[{"value":"x"}]}'` | `resource.payload.emails?.some(e => e.value === "x")` |
| `AND` | `WHERE a AND b` | `matchA(r) && matchB(r)` |
| `OR` | `WHERE a OR b` | `matchA(r) \|\| matchB(r)` |
| `NOT` | `WHERE NOT (...)` | `!match(r)` |

### Sort Implementation

```typescript
// In-Memory sort — works on any attribute path
function sortResources(
  resources: ScimResourceModel[],
  sortBy: string,
  sortOrder: 'ascending' | 'descending' = 'ascending',
): ScimResourceModel[] {
  return [...resources].sort((a, b) => {
    const valA = extractValue(a, sortBy);
    const valB = extractValue(b, sortBy);

    // Null-safe comparison
    if (valA == null && valB == null) return 0;
    if (valA == null) return 1;   // Nulls last
    if (valB == null) return -1;

    const cmp = typeof valA === 'string'
      ? valA.localeCompare(String(valB), undefined, { sensitivity: 'base' })
      : Number(valA) - Number(valB);

    return sortOrder === 'descending' ? -cmp : cmp;
  });
}
```

### Pagination

```typescript
// Same startIndex/count semantics as PostgreSQL OFFSET/LIMIT
function paginate<T>(items: T[], startIndex: number, count: number): { items: T[]; totalResults: number } {
  const offset = Math.max(0, startIndex - 1); // SCIM startIndex is 1-based
  return {
    items: items.slice(offset, offset + count),
    totalResults: items.length,
  };
}
```

---

## 7. ETag, Versioning & Concurrency

### ETag — Identical Behavior

Both implementations use the same `version` integer and the same ETag format:

```
ETag: W/"v{version}"
Example: W/"v1", W/"v5", W/"v42"
```

The version is incremented on every write (create starts at 1).

### Concurrency Comparison

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant ORCH as Orchestrator

    Note over A,ORCH: PostgreSQL: Row-level lock prevents concurrent writes
    Note over A,ORCH: In-Memory: Node.js single-thread prevents concurrent writes

    A->>ORCH: PATCH /Users/123, If-Match: W/"v5"
    Note over ORCH: Read resource → version=5 ✅ match
    Note over ORCH: Apply patch → version becomes 6
    ORCH-->>A: 200 OK, ETag: W/"v6"

    B->>ORCH: PATCH /Users/123, If-Match: W/"v5"
    Note over ORCH: Read resource → version=6 ❌ mismatch
    ORCH-->>B: 412 Precondition Failed
```

**Key difference**: PostgreSQL achieves concurrency safety via `SELECT ... FOR UPDATE` row locks (multi-threaded). In-memory achieves it simply because Node.js processes requests sequentially within the event loop (single-threaded). Both produce the same observable behavior for SCIM clients.

### Bulk Operation Difference

| Concern | PostgreSQL | In-Memory |
|---------|-----------|-----------|
| **Transaction semantics** | All-or-nothing via `BEGIN`/`COMMIT`/`ROLLBACK` | Best-effort: partial execution if error occurs |
| **Rollback on failure** | ✅ Automatic | ❌ Must manually undo completed ops |
| **Isolation** | READ COMMITTED (default) | Sequential execution = serializable |

```typescript
// In-Memory Bulk — no true transactions, but can implement rollback log
async processBulk(tenantId: string, ops: BulkOperation[]): Promise<BulkResponse> {
  const undoLog: Array<() => void> = [];
  const results: BulkResult[] = [];

  for (const op of ops) {
    try {
      const before = this.snapshot(tenantId); // Optional: capture state before
      const result = await this.executeOp(tenantId, op);
      undoLog.push(() => this.restore(tenantId, before));
      results.push(result);
    } catch (error) {
      // On failure with failOnErrors, undo all previous ops
      if (shouldAbort(error, results.length)) {
        for (const undo of undoLog.reverse()) undo();
        break;
      }
      results.push({ status: error.status, error: error.message });
    }
  }
  return { Operations: results };
}
```

---

## 8. Persistence Snapshots (Optional)

Since in-memory data is lost on process restart, an optional snapshot mechanism can provide basic durability:

### Snapshot Flow

```mermaid
flowchart LR
    subgraph RUNTIME["Runtime"]
        STORE["InMemoryStore<br/>(Maps in heap)"]
        TIMER["setInterval<br/>every 60s"]
        SHUTDOWN["process.on('SIGTERM')"]
    end

    subgraph DISK["Snapshot on Disk"]
        FILE["data/snapshot.json<br/>(or .json.gz)"]
    end

    subgraph STARTUP["Startup"]
        LOAD["Load snapshot<br/>into Maps"]
    end

    TIMER -->|"serialize()"| FILE
    SHUTDOWN -->|"serialize()"| FILE
    FILE -->|"on boot"| LOAD
    LOAD --> STORE

    style RUNTIME fill:#e3f2fd,color:#333
    style DISK fill:#fff3e0,color:#333
    style STARTUP fill:#e8f5e9,color:#333
```

### Implementation

```typescript
// src/infrastructure/persistence/memory/snapshot.service.ts

@Injectable()
export class SnapshotService implements OnModuleInit, OnModuleDestroy {
  private intervalHandle?: NodeJS.Timeout;

  constructor(
    private readonly store: InMemoryStore,
    @Inject('SNAPSHOT_PATH') private readonly snapshotPath: string,
  ) {}

  onModuleInit() {
    // Load existing snapshot on boot
    this.loadIfExists();
    // Auto-save every 60 seconds
    if (process.env.SNAPSHOT_INTERVAL_MS) {
      this.intervalHandle = setInterval(
        () => this.save(),
        Number(process.env.SNAPSHOT_INTERVAL_MS) || 60_000,
      );
    }
  }

  onModuleDestroy() {
    clearInterval(this.intervalHandle);
    this.save(); // Save on graceful shutdown
  }

  save(): void {
    const data = {
      version: 1,
      timestamp: new Date().toISOString(),
      tenants: Object.fromEntries(this.store.tenants),
      resources: Object.fromEntries(
        Array.from(this.store.resources.entries()).map(
          ([tid, map]) => [tid, Object.fromEntries(map)]
        )
      ),
      members: Object.fromEntries(
        Array.from(this.store.members.entries()).map(
          ([gid, map]) => [gid, Object.fromEntries(map)]
        )
      ),
      schemas: Object.fromEntries(this.store.schemas),
      resourceTypes: Object.fromEntries(this.store.resourceTypes),
      credentials: Object.fromEntries(this.store.credentials),
    };
    fs.writeFileSync(this.snapshotPath, JSON.stringify(data, null, 2));
  }

  loadIfExists(): void {
    if (!fs.existsSync(this.snapshotPath)) return;
    const raw = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf-8'));
    // Reconstruct Maps from JSON...
    for (const [tid, tenant] of Object.entries(raw.tenants ?? {})) {
      this.store.tenants.set(tid, tenant as TenantModel);
    }
    for (const [tid, resources] of Object.entries(raw.resources ?? {})) {
      const map = new Map<string, ScimResourceModel>();
      for (const [scimId, resource] of Object.entries(resources as any)) {
        map.set(scimId, resource as ScimResourceModel);
      }
      this.store.resources.set(tid, map);
    }
    // ... rebuild secondary indexes from loaded data
    this.rebuildIndexes();
  }

  private rebuildIndexes(): void {
    this.store.userNameIndex.clear();
    this.store.externalIdIndex.clear();
    for (const [tid, resources] of this.store.resources) {
      const nameIdx = new Map<string, string>();
      const extIdx = new Map<string, string>();
      for (const [scimId, r] of resources) {
        if (r.userName) nameIdx.set(r.userName.toLowerCase(), scimId);
        if (r.externalId) extIdx.set(r.externalId, scimId);
      }
      this.store.userNameIndex.set(tid, nameIdx);
      this.store.externalIdIndex.set(tid, extIdx);
    }
  }
}
```

### Snapshot vs PostgreSQL Backup Comparison

| Aspect | PostgreSQL (pg_dump / Azure Backup) | In-Memory Snapshot |
|--------|-----------------------------------|-------------------|
| **Frequency** | Continuous WAL + daily full | Configurable interval (default 60s) |
| **Data loss window** | ~0 (WAL replay) | Up to 60 seconds |
| **Point-in-time recovery** | ✅ Any timestamp | ❌ Latest snapshot only |
| **Size** | Compact (binary format) | Larger (JSON) |
| **Restore time** | Minutes (large DBs) | Milliseconds |
| **Cross-process sharing** | ✅ Multiple app instances | ❌ One file per instance |

---

## 9. Trade-offs & Limitations

### When In-Memory Works Well

| Scenario | Why It Works |
|----------|-------------|
| **Unit tests** | No setup, instant, deterministic |
| **Integration tests** | Full pipeline without Docker |
| **Demos** | `npm start` — no database needed |
| **Small deployments** (<10K resources) | Fast enough, zero ops burden |
| **Development** | No migration drift, instant restart |
| **CI/CD** | No `services: postgres` in GitHub Actions |
| **Edge/IoT** | Embedded in constrained environments |

### When In-Memory Fails

| Scenario | Why It Fails | Use PostgreSQL Instead |
|----------|-------------|----------------------|
| **>100K resources** | O(n) filter scans become slow (~100ms+) | GIN indexes: O(log n) |
| **Multi-instance** | Each replica has different data | Shared PostgreSQL |
| **Data durability required** | Process crash = data loss | WAL + backup |
| **Audit compliance** | No transaction log | pg audit + WAL |
| **Complex JSONB queries** | No GIN, full object traversal | `payload @>` with GIN |
| **Production SLA** | No failover, no replication | PostgreSQL HA |

### Memory Usage Estimates

| Resources | Avg Payload Size | Estimated Heap | Node.js Default Limit |
|-----------|-----------------|----------------|----------------------|
| 1,000 | 2 KB | ~5 MB | ✅ Well within 512 MB |
| 10,000 | 2 KB | ~50 MB | ✅ Comfortable |
| 50,000 | 2 KB | ~250 MB | ⚠️ Needs `--max_old_space_size=512` |
| 100,000 | 2 KB | ~500 MB | ⚠️ Needs `--max_old_space_size=1024` |
| 500,000 | 2 KB | ~2.5 GB | ❌ Unreasonable |

---

## 10. Deployment Modes

### Deployment Topology Comparison

```mermaid
flowchart TB
    subgraph PG_DEPLOY["PostgreSQL Deployment"]
        direction TB
        PG_APP["Container App<br/>PORT 8080"]
        PG_PRISMA["Prisma Client"]
        PG_DB[("PostgreSQL<br/>Azure Flexible Server")]
        PG_APP --> PG_PRISMA --> PG_DB
    end

    subgraph MEM_DEPLOY["In-Memory Deployment"]
        direction TB
        MEM_APP["Container App<br/>PORT 8080"]
        MEM_HEAP["JS Heap<br/>Map&lt;string, Map&gt;"]
        MEM_SNAP["data/snapshot.json<br/>(optional)"]
        MEM_APP --> MEM_HEAP
        MEM_HEAP -.->|"periodic save"| MEM_SNAP
    end

    style PG_DEPLOY fill:#e8f5e9,color:#333
    style MEM_DEPLOY fill:#fff3e0,color:#333
```

### Environment Variable Configuration

| Variable | PostgreSQL Mode | In-Memory Mode |
|----------|---------------|----------------|
| `DB_DRIVER` | `postgresql` (default) | `memory` |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db` | Not needed |
| `SNAPSHOT_PATH` | Not used | `./data/snapshot.json` (optional) |
| `SNAPSHOT_INTERVAL_MS` | Not used | `60000` (optional, default off) |
| `PORT` | `8080` | `8080` |
| `NODE_ENV` | `production` | `production` |
| All other env vars | Same | Same |

### Docker Differences

| Aspect | PostgreSQL Dockerfile | In-Memory Dockerfile |
|--------|---------------------|---------------------|
| **Build stages** | 4 (web → api → deps → runtime) | 3 (web → api → runtime) — skip Prisma WASM |
| **Runtime deps** | `@prisma/client`, WASM query engines | None — all in-memory |
| **Image size** | ~350 MB | ~200 MB (no Prisma engines) |
| **Entrypoint** | `prisma migrate deploy && node dist/main.js` | `node dist/main.js` |
| **Health check** | Same | Same |
| **Compose services** | `postgres:17-alpine` + app | App only |

```dockerfile
# Dockerfile.memory — simplified for in-memory mode
FROM node:24-alpine AS build
WORKDIR /app
COPY api/package*.json ./
RUN npm ci
COPY api/ .
RUN npm run build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DB_DRIVER=memory
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json .
# No Prisma, no WASM engines, no database migration
EXPOSE 8080
HEALTHCHECK CMD wget -qO- http://localhost:8080/health || exit 1
USER node
CMD ["node", "dist/main.js"]
```

---

## 11. Migration Plan — Current → In-Memory

### Overview

The in-memory migration is **simpler than the PostgreSQL migration** because it removes database dependencies rather than adding them. It shares the same Phase 1 (Repository Pattern) which is prerequisite for both paths.

### Phase Map Comparison

```mermaid
flowchart LR
    subgraph SHARED["Shared Phases"]
        P1["Phase 1<br/>Repository Pattern"]
        P2["Phase 2<br/>Unified Resource Model"]
        P5["Phase 5<br/>Domain PATCH Engine"]
        P6["Phase 6<br/>Data-Driven Discovery"]
        P7["Phase 7<br/>ETag & Versioning"]
        P8["Phase 8<br/>Schema Validation"]
        P9["Phase 9<br/>Bulk Operations"]
        P10["Phase 10<br/>/Me Endpoint"]
        P11["Phase 11<br/>Per-Tenant Credentials"]
        P12["Phase 12<br/>Sort & Cleanup"]
    end

    subgraph PG_ONLY["PostgreSQL-Only Phases"]
        P3_PG["Phase 3<br/>PostgreSQL Migration<br/>(CITEXT, JSONB, GIN)"]
        P4_PG["Phase 4<br/>Filter Push-Down<br/>(SQL operators)"]
    end

    subgraph MEM_ONLY["In-Memory-Only Phases"]
        P3_MEM["Phase 3M<br/>InMemory Repository<br/>Implementation"]
        P4_MEM["Phase 4M<br/>In-Memory Filter<br/>Evaluation"]
    end

    P1 --> P2
    P2 --> P3_PG
    P2 --> P3_MEM
    P3_PG --> P4_PG
    P3_MEM --> P4_MEM

    style SHARED fill:#e3f2fd,color:#333
    style PG_ONLY fill:#e8f5e9,color:#333
    style MEM_ONLY fill:#fff3e0,color:#333
```

### Side-by-Side Phase Comparison

| Phase | PostgreSQL Path | In-Memory Path | Shared? |
|-------|----------------|----------------|---------|
| P1 — Repository Pattern | Extract `IResourceRepository` interface | Same | ✅ 100% |
| P2 — Unified Resource Model | `scim_resource` Prisma model + migration | `ScimResourceModel` TypeScript type only | ✅ Model shared, storage differs |
| P3 — Storage Implementation | PostgreSQL migration (CITEXT, JSONB, GIN, schema changes, Docker Compose postgres service) | `InMemoryResourceRepository` (~200 LOC) | ❌ Entirely different |
| P4 — Filter Expansion | SQL operators (ILIKE, JSONB `@>`, pg_trgm) | `evaluateFilter()` with deep object traversal | ❌ Different implementation, same interface |
| P5 — PATCH Engine | Pure domain — no DB dependency | Same | ✅ 100% |
| P6 — Discovery | `tenant_schema` table (PostgreSQL) | `schemas Map` | ⚠️ Interface shared, storage differs |
| P7 — ETag & Versioning | `version INT` column, `FOR UPDATE` lock | `version` property, single-thread safe | ⚠️ Same logic, different concurrency model |
| P8 — Schema Validation | Pure domain | Same | ✅ 100% |
| P9 — Bulk Operations | `BEGIN`/`COMMIT` transaction | Undo log or best-effort | ⚠️ Different transaction semantics |
| P10 — /Me Endpoint | Pure application logic | Same | ✅ 100% |
| P11 — Per-Tenant Credentials | `tenant_credential` table | `credentials Map` | ⚠️ Interface shared, storage differs |
| P12 — Sort & Cleanup | `ORDER BY` SQL | `Array.sort()` | ⚠️ Same result, different implementation |

### Effort Comparison

| Phase | PostgreSQL LOC | In-Memory LOC | In-Memory Effort |
|-------|---------------|---------------|-----------------|
| P1 — Repository Pattern | ~300 | ~300 | Same (shared) |
| P2 — Unified Model | ~400 (schema + migration) | ~100 (TypeScript only) | 75% less |
| P3 — Storage Impl | ~600 (Prisma + Docker + Bicep) | ~250 | 60% less |
| P4 — Filters | ~300 (SQL builder) | ~150 (JS evaluator) | 50% less |
| P5 — PATCH Engine | ~400 | ~400 | Same (shared) |
| P6 — Discovery | ~200 | ~100 | 50% less |
| P7 — ETag | ~150 | ~80 | 47% less |
| P8 — Schema Validation | ~200 | ~200 | Same (shared) |
| P9 — Bulk Operations | ~250 | ~200 | 20% less |
| P10 — /Me | ~80 | ~80 | Same (shared) |
| P11 — Credentials | ~200 | ~100 | 50% less |
| P12 — Sort & Cleanup | ~200 | ~100 | 50% less |
| **Total** | **~3280** | **~2060** | **~37% less** |

---

## 12. Migration Phase Details

### Phase 3M — InMemory Repository Implementation

This replaces PostgreSQL Phase 3 (database migration) with a much simpler in-memory implementation.

#### Step 3M.1: Create InMemoryStore Singleton

```typescript
// Register as singleton in NestJS
@Module({
  providers: [{ provide: InMemoryStore, useValue: new InMemoryStore() }],
  exports: [InMemoryStore],
})
export class InMemoryStoreModule {}
```

#### Step 3M.2: Implement All Repository Interfaces

| Repository Interface | PostgreSQL Implementation | In-Memory Implementation |
|---------------------|--------------------------|-------------------------|
| `IResourceRepository` | `PrismaResourceRepository` (~300 LOC) | `InMemoryResourceRepository` (~200 LOC) |
| `ITenantRepository` | `PrismaTenantRepository` (~100 LOC) | `InMemoryTenantRepository` (~60 LOC) |
| `ISchemaRepository` | `PrismaSchemaRepository` (~80 LOC) | `InMemorySchemaRepository` (~50 LOC) |
| `IMembershipRepository` | `PrismaMembershipRepository` (~100 LOC) | `InMemoryMembershipRepository` (~60 LOC) |
| `ICredentialRepository` | `PrismaCredentialRepository` (~80 LOC) | `InMemoryCredentialRepository` (~40 LOC) |
| **Total** | **~660 LOC** | **~410 LOC** |

#### Step 3M.3: Case-Insensitive Handling

PostgreSQL uses CITEXT for transparent case-insensitivity. In-memory must handle this explicitly:

```typescript
// In-Memory: Explicit case folding for all lookups
async findByUserName(tenantId: string, userName: string): Promise<ScimResourceModel | null> {
  const scimId = this.store.userNameIndex
    .get(tenantId)
    ?.get(userName.toLowerCase()); // ← Explicit case folding
  if (!scimId) return null;
  return this.findById(tenantId, scimId);
}

// PostgreSQL: CITEXT handles it transparently
// SELECT * FROM scim_resource WHERE user_name = $1
// (CITEXT column, case comparison automatic)
```

#### Step 3M.4: Wire Dynamic Module

```typescript
// PersistenceModule.forRoot('memory') — see §3 Architecture Overview
// Controlled by DB_DRIVER environment variable
```

### Phase 4M — In-Memory Filter Evaluation

Since there's no database to push filters to, all filtering happens in JavaScript:

```typescript
// In-Memory filter evaluator — handles all SCIM operators
function evaluateScimFilter(
  resource: ScimResourceModel,
  ast: FilterNode,
): boolean {
  switch (ast.type) {
    case 'compare':
      return evaluateCompare(resource, ast as CompareNode);
    case 'logical':
      const logical = ast as LogicalNode;
      if (logical.op === 'and')
        return evaluateScimFilter(resource, logical.left) && evaluateScimFilter(resource, logical.right);
      if (logical.op === 'or')
        return evaluateScimFilter(resource, logical.left) || evaluateScimFilter(resource, logical.right);
      return false;
    case 'not':
      return !evaluateScimFilter(resource, (ast as NotNode).operand);
    default:
      return true;
  }
}

function evaluateCompare(resource: ScimResourceModel, node: CompareNode): boolean {
  const value = resolveAttributePath(resource, node.attrPath);

  switch (node.op) {
    case 'eq': return caseInsensitiveEquals(value, node.value);
    case 'ne': return !caseInsensitiveEquals(value, node.value);
    case 'co': return String(value ?? '').toLowerCase().includes(String(node.value).toLowerCase());
    case 'sw': return String(value ?? '').toLowerCase().startsWith(String(node.value).toLowerCase());
    case 'ew': return String(value ?? '').toLowerCase().endsWith(String(node.value).toLowerCase());
    case 'gt': return (value ?? '') > node.value;
    case 'ge': return (value ?? '') >= node.value;
    case 'lt': return (value ?? '') < node.value;
    case 'le': return (value ?? '') <= node.value;
    case 'pr': return value !== undefined && value !== null;
    default: return false;
  }
}

function resolveAttributePath(resource: ScimResourceModel, path: string): unknown {
  // Map first-class fields
  const firstClass: Record<string, unknown> = {
    username: resource.userName,
    displayname: resource.displayName,
    externalid: resource.externalId,
    id: resource.scimId,
    active: resource.active,
    'meta.created': resource.createdAt?.toISOString(),
    'meta.lastmodified': resource.updatedAt?.toISOString(),
  };
  const lower = path.toLowerCase();
  if (lower in firstClass) return firstClass[lower];

  // Navigate payload for nested/extension attributes
  return path.split('.').reduce((obj: any, key) => {
    if (Array.isArray(obj)) {
      // Multi-valued attribute — check if any element has this key
      return obj.map(item => item?.[key]).find(v => v !== undefined);
    }
    return obj?.[key];
  }, resource.payload);
}
```

---

## 13. Testing Strategy

### Test Pyramid with Both Implementations

```mermaid
flowchart TB
    subgraph UNIT["Unit Tests (Both — InMemory repo)"]
        U1["PatchEngine tests<br/>~80 tests, <5ms"]
        U2["FilterParser tests<br/>~40 tests"]
        U3["SchemaValidator tests<br/>~30 tests"]
        U4["MetaBuilder tests<br/>~15 tests"]
    end

    subgraph INTEGRATION["Integration Tests"]
        subgraph INT_MEM["In-Memory (fast, CI default)"]
            IM1["Full SCIM CRUD pipeline<br/>~100 tests, <2s total"]
            IM2["Filter evaluation<br/>~50 tests"]
            IM3["Bulk operations<br/>~20 tests"]
        end
        subgraph INT_PG["PostgreSQL (thorough, pre-deploy)"]
            PG1["Same tests as In-Memory<br/>+ index validation"]
            PG2["Transaction rollback tests"]
            PG3["Concurrency tests"]
        end
    end

    subgraph E2E["E2E / Live Tests"]
        E2E1["280 live tests<br/>scripts/live-test.ps1"]
    end

    UNIT --> INTEGRATION --> E2E

    style UNIT fill:#c8e6c9,color:#333
    style INT_MEM fill:#fff3e0,color:#333
    style INT_PG fill:#e8f5e9,color:#333
    style E2E fill:#e3f2fd,color:#333
```

### Running Tests Per Mode

```bash
# Unit tests — always use InMemory (fast, no setup)
npm test

# Integration tests — In-Memory (CI default)
DB_DRIVER=memory npm run test:e2e

# Integration tests — PostgreSQL (pre-deploy validation)
DB_DRIVER=postgresql DATABASE_URL=postgresql://... npm run test:e2e

# Live tests — works against either mode
npm run test:smoke
```

### Test Configuration Matrix

| Test Suite | In-Memory | PostgreSQL | Purpose |
|-----------|-----------|-----------|---------|
| Unit (jest) | ✅ Always | N/A | Domain logic correctness |
| E2E (supertest) | ✅ CI default | ✅ Pre-deploy | API contract verification |
| Live (pwsh) | ✅ | ✅ | End-to-end against running server |
| Load (k6) | ⚠️ Reveals scaling limits | ✅ | Performance validation |
| SCIM Validator | ✅ | ✅ | Microsoft SCIM compliance |

---

## 14. Decision Framework — When to Use Which

```mermaid
flowchart TD
    START["Choose Persistence<br/>Strategy"] --> Q1{"Production with<br/>SLA requirements?"}
    Q1 -->|Yes| PG["Use PostgreSQL"]
    Q1 -->|No| Q2{"Data must survive<br/>process restart?"}
    Q2 -->|"Yes, critical"| PG
    Q2 -->|"Nice to have"| Q3{"Expected resource<br/>count?"}
    Q2 -->|No| MEM["Use In-Memory"]
    Q3 -->|">50K"| PG
    Q3 -->|"<50K"| Q4{"Multi-instance<br/>deployment?"}
    Q4 -->|Yes| PG
    Q4 -->|"Single instance"| Q5{"Use case?"}
    Q5 -->|"Testing / CI"| MEM
    Q5 -->|"Demo / POC"| MEM
    Q5 -->|"Development"| MEM
    Q5 -->|"Edge / embedded"| MEM_SNAP["In-Memory<br/>+ Snapshot"]

    style PG fill:#e8f5e9,color:#333
    style MEM fill:#fff3e0,color:#333
    style MEM_SNAP fill:#ffe0b2,color:#333
```

### Decision Summary Table

| Criteria | Choose PostgreSQL | Choose In-Memory |
|----------|------------------|-----------------|
| **Environment** | Production, Staging | Dev, Test, Demo, CI/CD |
| **Data durability** | Must survive restarts | Ephemeral is OK |
| **Resource count** | >10K expected | <10K typical |
| **Scaling** | Multiple replicas needed | Single instance sufficient |
| **Response time SLA** | Filter queries must be <10ms | Best-effort acceptable |
| **Ops team** | Available to manage DB | Zero-ops desired |
| **Compliance** | Audit trail required | No compliance needs |
| **Infrastructure** | Cloud (Azure/AWS/GCP) | Laptop, IoT, serverless |

---

## 15. Appendix A — Mermaid Diagrams

### Complete SCIM Create User Flow (In-Memory)

```mermaid
sequenceDiagram
    participant IDP as Identity Provider
    participant AUTH as TenantAuthGuard
    participant CTRL as ResourceController
    participant ORCH as ResourceOrchestrator
    participant VALID as SchemaValidator
    participant REPO as InMemoryResourceRepository
    participant STORE as InMemoryStore

    IDP->>AUTH: POST /tenants/:id/Users<br/>Authorization: Bearer <token>

    rect rgb(255, 245, 230)
        Note over AUTH,STORE: Authentication (same as PostgreSQL)
        AUTH->>STORE: credentials.get(tenantId)
        STORE-->>AUTH: CredentialModel[]
        AUTH->>AUTH: bcrypt.compare(token, hash)
    end

    AUTH->>CTRL: Authorized request
    CTRL->>ORCH: create(tenantId, payload, baseUrl)

    rect rgb(230, 245, 255)
        Note over ORCH,VALID: Validation (same as PostgreSQL)
        ORCH->>STORE: schemas.get(tenantId)
        STORE-->>ORCH: SchemaModel[]
        ORCH->>VALID: validate(payload, schema, {mode: 'create'})
        VALID-->>ORCH: ✅ Valid
    end

    rect rgb(230, 255, 230)
        Note over ORCH,STORE: Persistence (In-Memory specific)
        ORCH->>REPO: assertUnique(tenantId, {userName})
        REPO->>STORE: userNameIndex.get(tenantId).get(lower(userName))
        STORE-->>REPO: null (no conflict)

        ORCH->>REPO: create({tenantId, type:'User', payload, ...})
        REPO->>STORE: resources.get(tenantId).set(scimId, model)
        REPO->>STORE: userNameIndex.get(tenantId).set(lower(userName), scimId)
        STORE-->>REPO: ScimResourceModel {version: 1}
    end

    REPO-->>ORCH: ScimResourceModel
    ORCH-->>CTRL: SCIM User JSON
    CTRL-->>IDP: 201 Created<br/>ETag: W/"v1"<br/>Location: /Users/:scimId
```

### List Users with Filter (In-Memory vs PostgreSQL)

```mermaid
sequenceDiagram
    participant CLIENT as Client
    participant ORCH as Orchestrator
    participant FP as FilterPlanner

    CLIENT->>ORCH: GET /Users?filter=userName co "john"

    alt PostgreSQL Path
        ORCH->>FP: plan(ast)
        FP-->>ORCH: {sqlWhere: {userName: {contains: "john", mode: "insensitive"}}}
        ORCH->>ORCH: PrismaRepo.query({where: sqlWhere})
        Note over ORCH: PostgreSQL uses pg_trgm GIN index<br/>~2ms for 10K users
    else In-Memory Path
        ORCH->>FP: plan(ast)
        FP-->>ORCH: {inMemoryFilter: (r) => r.userName.includes("john")}
        ORCH->>ORCH: InMemoryRepo.query({where: filter})
        Note over ORCH: Array.filter() full scan<br/>~5ms for 10K users, ~50ms for 100K
    end

    ORCH-->>CLIENT: ListResponse {Resources: [...], totalResults: N}
```

---

## 16. Appendix B — Comparative Code Examples

### Creating a User — Side by Side

```typescript
// ═══════════════════════════════════════════════
// PostgreSQL (PrismaResourceRepository)
// ═══════════════════════════════════════════════
async create(input: ResourceCreateInput): Promise<ScimResourceModel> {
  const created = await this.prisma.scimResource.create({
    data: {
      endpointId: input.tenantId,
      resourceType: input.resourceType,
      scimId: crypto.randomUUID(),
      externalId: input.externalId,
      userName: input.userName,       // CITEXT column
      displayName: input.displayName, // CITEXT column
      active: input.active ?? true,
      payload: input.payload,         // JSONB column
      version: 1,
    }
  });
  return this.toModel(created);
}

// ═══════════════════════════════════════════════
// In-Memory (InMemoryResourceRepository)
// ═══════════════════════════════════════════════
async create(input: ResourceCreateInput): Promise<ScimResourceModel> {
  const scimId = crypto.randomUUID();
  const model: ScimResourceModel = {
    id: this.store.generateId(),
    tenantId: input.tenantId,
    resourceType: input.resourceType,
    scimId,
    externalId: input.externalId ?? null,
    userName: input.userName ?? null,
    displayName: input.displayName ?? null,
    active: input.active ?? true,
    payload: input.payload,              // Plain JS object (no JSONB)
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  this.store.resources.get(input.tenantId)!.set(scimId, model);
  // Manually maintain secondary indexes (CITEXT → toLowerCase)
  if (model.userName) {
    this.store.userNameIndex.get(input.tenantId)!
      .set(model.userName.toLowerCase(), scimId);
  }
  return model;
}
```

### Filtering — Side by Side

```typescript
// ═══════════════════════════════════════════════
// PostgreSQL — SQL push-down
// ═══════════════════════════════════════════════
// Filter: userName co "john" AND active eq true
const where = {
  AND: [
    { userName: { contains: 'john', mode: 'insensitive' } }, // → ILIKE '%john%'
    { active: true },                                         // → active = true
  ]
};
const results = await prisma.scimResource.findMany({ where });
// Uses pg_trgm GIN index + B-tree index

// ═══════════════════════════════════════════════
// In-Memory — JavaScript evaluation
// ═══════════════════════════════════════════════
// Same filter: userName co "john" AND active eq true
const results = Array.from(tenantResources.values())
  .filter(r =>
    r.userName?.toLowerCase().includes('john') &&
    r.active === true
  );
// Full scan of all resources in tenant
```

### Unique Constraint — Side by Side

```typescript
// ═══════════════════════════════════════════════
// PostgreSQL — Database-enforced uniqueness
// ═══════════════════════════════════════════════
try {
  await prisma.scimResource.create({ data: { userName: 'john@example.com', ... } });
} catch (e) {
  if (e.code === 'P2002') {
    // Unique constraint violation — CITEXT makes this case-insensitive
    throw createScimError({ status: 409, detail: 'userName already exists' });
  }
}

// ═══════════════════════════════════════════════
// In-Memory — Application-enforced uniqueness
// ═══════════════════════════════════════════════
const existing = this.store.userNameIndex
  .get(tenantId)
  ?.get('john@example.com'.toLowerCase()); // Manual case folding

if (existing && existing !== excludeScimId) {
  throw createScimError({ status: 409, detail: 'userName already exists' });
}
// Then insert into Map + update index
```

---

## Summary: Key Architectural Decisions

| Decision | PostgreSQL | In-Memory | Rationale |
|----------|-----------|-----------|-----------|
| **Primary use** | Production | Dev/Test/Demo | Match deployment needs to storage capability |
| **Interface** | `IResourceRepository` | Same | Persistence agnosticism (Principle P4) |
| **Case-insensitive** | CITEXT type | `toLowerCase()` | Same RFC compliance, different mechanism |
| **JSONB query** | GIN index + `@>` | Deep object traversal | Same result, different performance profile |
| **Unique constraints** | DB-level partial index | Application-level Map check | Both throw 409 on conflict |
| **Concurrency** | Row locks (MVCC) | Single-thread (event loop) | Both prevent lost updates |
| **Transaction** | `BEGIN`/`COMMIT` | Undo log (optional) | Full atomicity only in PostgreSQL |
| **Persistence** | WAL + disk | Heap (+ optional snapshot) | PostgreSQL for durability, In-Memory for speed |
| **Scaling** | Horizontal (shared DB) | Vertical only | In-Memory limited to single process |
| **Module selection** | `PersistenceModule.forRoot('postgresql')` | `PersistenceModule.forRoot('memory')` | Runtime env var: `DB_DRIVER` |
