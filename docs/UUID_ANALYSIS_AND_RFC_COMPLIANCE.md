# UUID Usage Analysis — RFC Compliance & Best Practices

> **Date:** 2026-02-20  
> **Phase:** 3 — PostgreSQL Migration  
> **Branch:** `feat/torfc1stscimsvr`  

---

## 1. What the RFCs Say About `id`

### RFC 7643 §3.1 — Common Attributes

The SCIM `id` attribute is defined as:

> "A unique identifier for a SCIM resource **as defined by the service provider**. Each representation of the resource MUST include a non-empty `id` value. This identifier MUST be unique across the SCIM service provider's entire set of resources. It MUST be a stable, non-reassignable identifier that does not change when the same resource is returned in subsequent requests. The value of the `id` attribute is always issued by the service provider and MUST NOT be specified by the client."

**Key characteristics per the RFC:**

| Characteristic | Value |
|---|---|
| `caseExact` | `true` |
| `mutability` | `readOnly` |
| `returned` | `always` |
| `uniqueness` | `server` (unique within the service provider) |
| `type` | `string` |

### What the RFC Does NOT Say

- **No UUID mandate** — The RFC specifies `id` as type `string`, not as a UUID
- **No format requirement** — The RFC says "as defined by the service provider"
- **No length requirement** — Any non-empty string is technically compliant
- **The string `"bulkId"` is reserved** — MUST NOT be used as an `id` value

### What the RFC Examples Use

Every single example in RFC 7643 uses UUID format:

| Example | Section | `id` Value |
|---|---|---|
| Minimal User | §8.1 | `2819c223-7f76-453a-919d-413861904646` |
| Full User | §8.2 | `2819c223-7f76-453a-919d-413861904646` |
| Enterprise User | §8.3 | `2819c223-7f76-453a-919d-413861904646` |
| Group | §8.4 | `e9e30dba-f08f-4109-8486-d5c6a331660a` |
| Group members[].value | §8.4 | `2819c223-7f76-453a-919d-413861904646` |
| Manager.value | §8.3 | `26118915-6090-4610-87e4-49d8ca9f808d` |

### RFC 7643 §9.3 — Privacy Considerations

> "SCIM defines attributes such as `id`, `externalId`, and SCIM resource URIs, which cause new PII to be generated [...] Where possible, assign and bind identifiers to specific tenants and/or clients."

UUIDs are recommended for privacy because they are:
- Not sequential (unlike auto-increment IDs)
- Not enumerable
- Opaque to clients

---

## 2. Industry Best Practices

### Why UUID Is the De Facto Standard

| Practice | Rationale |
|---|---|
| **UUID v4 (random)** | Most common; prevents ID guessing and enumeration attacks |
| **UUID v7 (time-sorted)** | Better index locality for B-tree indexes; used by our `gen_random_uuid()` |
| **Globally unique** | Enables federation, cross-domain identity, and bulk imports |
| **128-bit entropy** | Collision probability is negligible (~1 in 2^122 for v4) |

### Major SCIM Implementations Using UUID

| Provider | `id` Format |
|---|---|
| Microsoft Entra ID | UUID v4 |
| Okta | Alphanumeric (not UUID, but opaque) |
| OneLogin | Numeric (legacy; newer APIs use UUID) |
| AWS SSO | UUID v4 |
| PingIdentity | UUID v4 |

### Our Implementation

```prisma
model ScimResource {
  id     String @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  scimId String @db.Uuid
  ...
}
```

- **`id`** — Internal storage key, PostgreSQL UUID, auto-generated
- **`scimId`** — The SCIM-visible `id` attribute, also UUID, also auto-generated
- **`gen_random_uuid()`** — PostgreSQL's built-in UUID v4 generator

---

## 3. Our UUID Design Decisions

### Decision 1: UUID for `scimId` (the SCIM `id` attribute)

| Aspect | Assessment |
|---|---|
| **RFC compliant?** | ✅ Yes — RFC allows any string; UUID is the most common choice |
| **Best practice?** | ✅ Yes — aligns with Microsoft Entra ID and most SCIM providers |
| **Trade-off** | Requires UUID guard (Issue 15) since the DB column enforces format |

### Decision 2: `@db.Uuid` Column Type

| Aspect | Assessment |
|---|---|
| **Benefit** | 16 bytes storage vs 36 bytes for `TEXT`; native UUID comparison; index-efficient |
| **Benefit** | Database-level format validation — prevents corrupt data |
| **Trade-off** | Requires application-layer guard for non-UUID lookup attempts |
| **Alternative rejected** | `String @db.Text` would accept any string but lose UUID benefits |

### Decision 3: UUID Guard at Repository Layer

| Aspect | Assessment |
|---|---|
| **Location** | Repository methods (`findByScimId`, `findByScimIds`, `findWithMembers`) |
| **Behavior** | Non-UUID input → `return null` (semantically: "cannot exist") |
| **InMemory impact** | None — InMemory uses `Map<string, ...>` with no type constraint |
| **SCIM contract** | Preserved — clients see 404 for non-existent resources regardless of ID format |

---

## 4. `externalId` — Client-Provided Identifier

Per RFC 7643 §3.1:

> "`externalId` [...] is always issued by the provisioning client and MUST NOT be specified by the service provider."

Our schema stores `externalId` as `String?` (nullable TEXT, not UUID) — correctly allowing any client-provided string format. This is the right choice since the client controls this value.

---

## 5. Conclusion

| Attribute | Our Format | RFC Requirement | Best Practice | Verdict |
|---|---|---|---|---|
| `id` (SCIM) | UUID v4 | Any non-empty string | UUID | ✅ Optimal |
| `id` (internal) | UUID v4 | N/A (not exposed) | UUID or auto-increment | ✅ Good |
| `externalId` | Any string | Any string (client-owned) | Any string | ✅ Correct |
| Group `members[].value` | UUID (references `scimId`) | Must match `id` of referenced resource | UUID (matches `id`) | ✅ Correct |

**Our UUID implementation is RFC-compliant, follows industry best practices, and aligns with major SCIM providers' choices. The UUID guard (`uuid-guard.ts`) correctly handles the edge case of non-UUID lookup attempts at the repository layer.**
