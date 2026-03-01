# Repository Interface & Implementation Analysis

> **Date:** 2026-02-20  
> **Phase:** 3 — PostgreSQL Migration  
> **Branch:** `feat/torfc1stscimsvr`  

---

## 1. Interface Design Assessment

### IUserRepository (7 methods)

| Method | Purpose | Required? | Assessment |
|---|---|---|---|
| `create` | Create user → `UserRecord` | ✅ Essential | Correct |
| `findByScimId` | Lookup by SCIM id → `UserRecord \| null` | ✅ Essential | Correct |
| `findAll` | List with optional filter/sort → `UserRecord[]` | ✅ Essential | Correct |
| `update` | Update by internal ID → `UserRecord` | ✅ Essential | Correct |
| `delete` | Delete by internal ID → `void` | ✅ Essential | Correct |
| `findConflict` | Uniqueness check (userName + externalId) → `UserConflictResult \| null` | ✅ Essential | Correct |
| `findByScimIds` | Batch SCIM ID → internal ID resolution → `Pick<UserRecord, 'id' \| 'scimId'>[]` | ✅ Essential | Correct (used by group membership) |

**Verdict:** Complete and minimal. No missing methods. No unnecessary methods.

### IGroupRepository (9 methods + 1 composite)

| Method | Purpose | Required? | Assessment |
|---|---|---|---|
| `create` | Create group → `GroupRecord` | ✅ Essential | Correct |
| `findByScimId` | Lookup by SCIM id (no members) → `GroupRecord \| null` | ✅ Essential | Correct |
| `findWithMembers` | Lookup by SCIM id (with members) → `GroupWithMembers \| null` | ✅ Essential | Correct |
| `findAllWithMembers` | List with members → `GroupWithMembers[]` | ✅ Essential | Correct |
| `update` | Update by internal ID → `GroupRecord` | ✅ Essential | Correct |
| `delete` | Delete by internal ID → `void` | ✅ Essential | Correct |
| `findByDisplayName` | Uniqueness check → `{ scimId } \| null` | ✅ Essential | Correct |
| `findByExternalId` | Uniqueness check → `GroupRecord \| null` | ✅ Essential | Correct |
| `addMembers` | Add members to a group → `void` | ✅ Essential | Correct (PATCH add) |
| `updateGroupWithMembers` | Atomic update + replace members → `void` | ✅ Essential | Correct (PUT operation) |

**Verdict:** Complete and minimal. The split between `findByScimId` (lightweight) and `findWithMembers` (includes members JOIN) is a good performance optimization.

---

## 2. Implementation Parity

### Method Coverage: Prisma vs InMemory

| Method | IUserRepository | Prisma ✅ | InMemory ✅ |
|---|---|---|---|
| `create` | ✅ | ✅ | ✅ |
| `findByScimId` | ✅ | ✅ + UUID guard | ✅ |
| `findAll` | ✅ | ✅ | ✅ |
| `update` | ✅ | ✅ | ✅ |
| `delete` | ✅ | ✅ | ✅ |
| `findConflict` | ✅ | ✅ | ✅ |
| `findByScimIds` | ✅ | ✅ + UUID filter | ✅ |

| Method | IGroupRepository | Prisma ✅ | InMemory ✅ |
|---|---|---|---|
| `create` | ✅ | ✅ | ✅ |
| `findByScimId` | ✅ | ✅ + UUID guard | ✅ |
| `findWithMembers` | ✅ | ✅ + UUID guard | ✅ |
| `findAllWithMembers` | ✅ | ✅ | ✅ |
| `update` | ✅ | ✅ | ✅ |
| `delete` | ✅ | ✅ | ✅ |
| `findByDisplayName` | ✅ | ✅ | ✅ |
| `findByExternalId` | ✅ | ✅ | ✅ |
| `addMembers` | ✅ | ✅ | ✅ |
| `updateGroupWithMembers` | ✅ | ✅ | ✅ |

Both `clear()` methods exist only on InMemory implementations (test helper, not in interface). This is correct — it's used by test setup/teardown only.

**Verdict:** Full parity. Every interface method has matching implementations in both backends.

---

## 3. Case-Sensitivity Handling

| Backend | Mechanism | Where |
|---|---|---|
| **Prisma/PostgreSQL** | CITEXT column type | `userName`, `displayName` columns |
| **InMemory** | `.toLowerCase()` comparison | `findConflict`, `findByDisplayName` query-time |

Both approaches produce identical behavior for SCIM case-insensitive attribute comparison (RFC 7643 §2.1).

---

## 4. UUID Guard Asymmetry

| Backend | UUID Guard? | Reason |
|---|---|---|
| **Prisma** | ✅ Yes | PostgreSQL `@db.Uuid` column rejects non-UUID strings |
| **InMemory** | ❌ No | `Map<string, ...>` accepts any key; `.get("nonexistent")` → `undefined` → `null` |

This asymmetry is correct:
- The guard exists **because of** PostgreSQL's strict UUID column type
- InMemory doesn't need it — the `Map.get()` returns `undefined` naturally
- Both produce the same observable behavior: non-existent ID → `null` → 404

---

## 5. JSDoc Issues Found & Fixed

| File | Issue | Fix |
|---|---|---|
| `user.repository.interface.ts` | Header said "SQLite / PostgreSQL via Prisma" | Updated to "PostgreSQL via Prisma" + Phase 3 note |
| `user.repository.interface.ts` | `findConflict` JSDoc referenced `userNameLower` (removed column) | Updated to reference CITEXT/toLowerCase |
| `user.repository.interface.ts` | `findAll` dbFilter example used `{ userNameLower: 'alice' }` | Updated to `{ userName: 'alice' }` |

---

## 6. Conclusion

The repository layer is well-designed:

- **Interfaces are minimal and complete** — no missing operations for SCIM CRUD + uniqueness
- **Both implementations have full method parity**
- **Case-sensitivity is correctly handled** in both backends
- **UUID guard asymmetry is architecturally correct** (guards where needed, no-ops where not)
- **Three stale JSDoc references** were found and fixed in `user.repository.interface.ts`
