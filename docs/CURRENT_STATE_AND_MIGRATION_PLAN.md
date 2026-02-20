# SCIM Server: Current State Analysis & Ideal Architecture Migration Plan

This document provides a comprehensive analysis of the current state of the SCIM Server repository (specifically the `api` folder) compared against the ideal, RFC-first architecture defined in `IDEAL_SCIM_ARCHITECTURE_RFC_FIRST.md` and `COMPLETE_AGNOSTIC_SCIM_ARCHITECTURE.md`. 

It outlines the gaps in the current implementation and provides a detailed, step-by-step migration plan to achieve the ideal state.

---

## 1. Current State Analysis vs. Ideal Architecture

### 1.1. Database & Persistence Layer
*   **Ideal:** PostgreSQL utilizing `JSONB` for dynamic SCIM payloads and GIN indexes for O(1) filter performance.
*   **Current:** SQLite (`api/prisma/schema.prisma`). SCIM payloads are stored as stringified JSON in the `rawPayload` column.
*   **Gap:** SQLite lacks native, indexable JSON support. To achieve case-insensitive uniqueness (RFC 7643 §2.1), the schema relies on derived columns (`userNameLower`, `displayNameLower`), which is a documented compromise. Most importantly, complex SCIM filters cannot be pushed to the database.

### 1.2. Filtering & Querying (RFC 7644 §3.4)
*   **Ideal:** SCIM filters are parsed into an Abstract Syntax Tree (AST) and translated directly into database queries (e.g., PostgreSQL `jsonb_path_ops`).
*   **Current:** An excellent AST parser exists (`api/src/modules/scim/filters/scim-filter-parser.ts`). However, `apply-scim-filter.ts` reveals that only simple `eq` filters on indexed columns (`userNameLower`, `externalId`) are pushed to the DB. For any complex filter (e.g., `emails.type eq "work"`), the system fetches *all* records for the tenant and evaluates the AST in-memory.
*   **Gap:** Massive performance and scalability bottleneck. In-memory evaluation of thousands of records per request is not viable for production multi-tenant environments.

### 1.3. Schema & Configuration Engine (RFC 7643)
*   **Ideal:** Dynamic, tenant-specific schemas stored in the database. A robust Schema Validator enforces `mutability`, `returned`, and `type` characteristics dynamically at runtime.
*   **Current:** Schemas are hardcoded in `api/src/modules/scim/controllers/endpoint-scim-discovery.controller.ts` (e.g., `private userSchema()`). Validation in services (`endpoint-scim-users.service.ts`) is basic and manual.
*   **Gap:** The system cannot support tenant-specific custom extensions (e.g., `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`) without modifying source code.

### 1.4. The PATCH Engine (RFC 7644 §3.5.2)
*   **Ideal:** An in-memory JSON patch engine that utilizes the AST parser to resolve value selection filters (e.g., `emails[type eq "work"]`) and validates the mutated object against the dynamic schema before saving.
*   **Current:** Implemented via a custom, manual string/object manipulation function (`applyPatchOperationsForEndpoint`). It manually parses dot-notation and value paths using regex/string splitting.
*   **Gap:** The current implementation is brittle, hard to maintain, and prone to edge-case bugs when handling deeply nested or complex RFC 7644 patch scenarios.

### 1.5. Missing RFC 7644 Features
*   **Bulk Operations (`/Bulk`):** Explicitly marked as `supported: false` in the discovery controllers. Not implemented.
*   **Authenticated Subject Alias (`/Me`):** Not implemented.
*   **ETag Concurrency Control:** Advertised as `supported: true` in `/ServiceProviderConfig`, but `If-Match` and `If-None-Match` headers are not actually extracted or evaluated in the resource controllers (`endpoint-scim-users.controller.ts`).

---

## 2. Step-by-Step Migration Plan

To bring the current implementation to the ideal state, the following phased approach is recommended. This sequence ensures that foundational bottlenecks (like the database) are resolved before building advanced features on top of them.

### Phase 1: Database Migration & Foundation (The Enabler)
*Reasoning: You cannot push complex AST filters to the database or support dynamic schemas efficiently without a document-capable relational database. To align with the Agnostic Architecture, we must implement the Repository Pattern while choosing a concrete persistence layer.*

1.  **Implement Repository Interfaces:** Create `IResourceRepository`, `ISchemaRepository`, and `ITenantConfigRepository` interfaces in the Business Logic Layer. Ensure the SCIM Engine only depends on these interfaces, not Prisma directly.
2.  **Choose Concrete Persistence (PostgreSQL):** While the architecture is agnostic, PostgreSQL is chosen as the concrete implementation for its superior hybrid relational/document capabilities (`JSONB` and `GIN` indexes).
3.  **Migrate Prisma to PostgreSQL:** Update `api/prisma/schema.prisma` to use `provider = "postgresql"`.
4.  **Convert Payload Storage:** Change `rawPayload String` to `data JsonB` in the Prisma schema.
5.  **Remove SQLite Compromises:** Drop the `userNameLower` and `displayNameLower` columns. Utilize PostgreSQL's `CITEXT` (Case-Insensitive Text) extension for `userName` and `displayName` to natively support RFC 7643 §2.1 case-exactness rules.
6.  **Add GIN Indexes:** Create a Prisma migration with raw SQL to add a GIN index on the `data` column (`CREATE INDEX idx_scim_data_gin ON "ScimUser" USING GIN (data jsonb_path_ops);`).
7.  **Implement Concrete Repositories:** Create `PostgresResourceRepository` (implementing `IResourceRepository`) that uses Prisma to interact with the new PostgreSQL schema.

### Phase 2: Dynamic Schema & Configuration Engine
*Reasoning: Before fixing the PATCH engine or validation, the system needs to know what the rules are dynamically per tenant.*

1.  **Create Schema Models:** Add `TenantSchema`, `TenantResourceType`, and `TenantConfig` models to `schema.prisma`, linking them to the existing `Endpoint` model. This allows each tenant to define their own custom resources (e.g., `EnterpriseUser`, `Device`, `Role`) beyond the standard `User` and `Group`.
    *   **Attribute Persistence (`TenantSchema`):** The `TenantSchema` model must store attribute definitions as a `JSONB` column (e.g., `attributes JsonB`). This allows the database to store the deeply nested, recursive nature of SCIM attributes (where a `complex` attribute contains an array of `subAttributes`, which themselves have `type`, `mutability`, etc.) exactly as defined in RFC 7643 §2.2, without requiring a massive, brittle relational table structure for every single sub-attribute.
    *   **ResourceType Persistence (`TenantResourceType`):** The `TenantResourceType` model must store the `schema` (the base schema URI, e.g., `urn:ietf:params:scim:schemas:core:2.0:User`), the `endpoint` (the relative URI, e.g., `/Users`), and a `schemaExtensions` `JSONB` column. The `schemaExtensions` column stores an array of objects defining the extension schema URIs and whether they are `required` (boolean), exactly as defined in RFC 7643 §6.
    *   **The Relational Link:** The `TenantResourceType` acts as the "glue". When a client queries a `ResourceType` (e.g., `User`), the system looks at the `schema` URI and the `schemaExtensions` URIs defined in the `TenantResourceType` record. It then uses those URIs to look up the corresponding `TenantSchema` records to retrieve the actual `attributes JsonB` definitions. This ensures that a single schema definition (e.g., an Enterprise Extension) can be reused across multiple Resource Types.
2.  **Implement `ISchemaRepository`:** Create a service to fetch and cache tenant schemas and resource types from the database (using Redis or in-memory LRU).
3.  **Build the RFC 7643 Schema Validator:** Create a dedicated validation service that takes a JSON payload and a `TenantSchema` definition. It must enforce all RFC 7643 §2.2 attribute characteristics:
    *   `type` & `multiValued`: Ensure data types match (string, boolean, complex, etc.) and arrays are used when required.
    *   `mutability`: Strip `readOnly` fields on input; reject changes to `immutable` fields on PUT/PATCH; allow `readWrite` and `writeOnly`.
    *   `returned`: Strip `writeOnly` fields (like passwords) on output; handle `always`, `never`, `default`, and `request` characteristics.
    *   `uniqueness`: Enforce `server` and `global` uniqueness constraints against the database.
    *   `caseExact`: Ensure case-sensitive or case-insensitive matching (supported by Phase 1 CITEXT).
    *   `required`: Reject payloads missing mandatory attributes.
    *   `canonicalValues`: Restrict inputs to allowed predefined values (e.g., "work", "home").
    *   `referenceTypes`: Validate that `reference` attributes point to valid resource URIs (e.g., `User`, `Group`).
4.  **Refactor Discovery Controllers:** Update `EndpointScimDiscoveryController` to serve the three mandatory discovery endpoints dynamically from the database instead of using hardcoded JSON methods, strictly adhering to RFC 7644 §4:
    *   **`/ServiceProviderConfig`:** Must return the `TenantConfig` detailing supported operations (e.g., `patch`, `bulk`, `filter`, `etag`, `sort`) and authentication schemes. This dictates to the client exactly what the server is capable of.
    *   **`/Schemas`:** Must return the `TenantSchema` definitions. This allows clients to discover the exact attribute characteristics (type, mutability, required, etc.) for every core and extension schema supported by the tenant.
    *   **`/ResourceTypes`:** Must return the `TenantResourceType` definitions. This dynamically lists all resources configured for the specific tenant (e.g., `User`, `Group`, `Device`), including their base schema, schema extensions, and the exact HTTP endpoint URIs where they can be accessed.

### Phase 3: Query Pushdown & AST Translation
*Reasoning: With JSONB in place, we can eliminate the in-memory filtering bottleneck.*

1.  **Refactor `apply-scim-filter.ts`:** Modify the filter builder. Instead of returning an `inMemoryFilter` function for complex queries, translate the `FilterNode` AST directly into Prisma JSON filtering syntax or raw PostgreSQL `jsonb_path_ops` queries.
    *   *Example:* AST `emails.type eq "work"` translates to Prisma `data: { path: ['emails'], array_contains: [{ type: 'work' }] }`.
2.  **Eliminate In-Memory Filtering:** Remove the fallback to `evaluateFilter` entirely. Ensure all filtering happens at the database level for O(1) or O(log N) performance.

### Phase 4: Robust PATCH Engine & Concurrency
*Reasoning: PATCH is the most complex SCIM operation. It requires the dynamic schema validator (Phase 2) to ensure mutations are legal.*

1.  **Refactor PATCH Logic:** Replace the manual `applyPatchOperationsForEndpoint` with a robust JSON Patch library (e.g., `fast-json-patch`).
2.  **Integrate AST for Value Selection:** When a PATCH path includes a filter (e.g., `emails[type eq "work"]`), use the existing `scim-filter-parser.ts` to evaluate the in-memory array, find the target index, and apply the patch to that specific index.
3.  **Validate Mutations:** After applying the patch in-memory, run the *entire* mutated JSON object through the Schema Validator (from Phase 2) to ensure no required attributes were removed or immutable attributes changed.
4.  **Implement ETag Concurrency:** Add logic in the controllers (`endpoint-scim-users.controller.ts`) to extract `If-Match` and `If-None-Match` headers using `@Headers('if-match')`. Pass these to the services to enforce Optimistic Locking during the Prisma `update` operation (`where: { id: user.id, version: expectedVersion }`).

### Phase 5: Advanced RFC 7644 Features
*Reasoning: These are additive features that rely on the solid foundation built in Phases 1-4.*

1.  **Implement `/Bulk` Endpoint:** Create a `BulkEngine` service.
    *   Parse the `Operations` array.
    *   Execute operations sequentially (or in parallel if no dependencies exist).
    *   Implement `bulkId` cross-referencing (e.g., replacing `"value": "bulkId:qwerty"` with the newly generated database ID mid-transaction).
2.  **Implement `/Me` Endpoint:** Add a controller that extracts the `sub` claim from the JWT, resolves it to a `ScimUser.id` via the database, and internally routes the request to the standard `GET /Users/{id}` or `PATCH /Users/{id}` methods.

---

## 3. Conclusion

The current repository has an excellent foundation, particularly with its multi-endpoint routing and the existence of a formal AST parser for SCIM filters. However, the reliance on SQLite and stringified JSON payloads forces severe compromises in performance (in-memory filtering) and maintainability (manual PATCH manipulation).

By executing this migration plan—starting with the database layer and moving up to dynamic schemas and query pushdown—the system will achieve strict RFC compliance, infinite extensibility, and enterprise-grade performance.