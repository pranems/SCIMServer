# 🧪 Test Organization Recommendations

> **Status**: Active guidance (partially strategic; validate against current repo layout before adoption)  
> **Last Updated**: February 18, 2026  
> **Baseline**: SCIMServer v0.10.0

> Best-practice test strategy for a **NestJS + Prisma + SQLite** SCIM 2.0 API server.
>
> **Created:** 2026-02-11 | **Project:** SCIMServer

---

## Table of Contents

- [1. Three-Tier Test Structure](#1-three-tier-test-structure)
- [2. File Layout](#2-file-layout)
- [3. Jest Configuration Strategy](#3-jest-configuration-strategy)
- [4. NPM Scripts Convention](#4-npm-scripts-convention)
- [5. Test Naming Conventions](#5-test-naming-conventions)
- [6. Test Isolation Principles](#6-test-isolation-principles)
- [7. Shared Test Helpers](#7-shared-test-helpers)
- [8. Coverage Targets](#8-coverage-targets)
- [9. CI Pipeline Stages](#9-ci-pipeline-stages)
- [10. Summary](#10-summary)

---

## 1. Three-Tier Test Structure

| Tier | Purpose | Speed | Runs When |
|------|---------|-------|-----------|
| **Unit** | Isolated logic, mocked deps | < 10s | Every save / pre-commit |
| **Integration / E2E** | Real HTTP + real DB | < 60s | Pre-push / CI pipeline |
| **Smoke** | Deployed instance verification | < 30s | Post-deploy |

### Testing Pyramid

```
        ╱╲
       ╱  ╲        Smoke / Live Tests (scripts/live-test.ps1)
      ╱ 🔥 ╲       → Against real deployed instance
     ╱──────╲
    ╱        ╲      E2E / Integration Tests
   ╱   🔗    ╲     → Real HTTP requests, real DB, full middleware
  ╱────────────╲
 ╱              ╲   Unit Tests
╱    ⚙️  ⚙️  ⚙️  ╲  → Isolated logic, mocked dependencies
╱────────────────╲
```

**Target ratio:** ~70% Unit · ~20% Integration/E2E · ~10% Smoke

---

## 2. File Layout

```
api/
├── src/
│   └── modules/
│       └── feature/
│           ├── feature.service.ts
│           ├── feature.service.spec.ts       ← colocated unit test
│           ├── feature.controller.ts
│           └── feature.controller.spec.ts    ← colocated unit test
├── test/
│   ├── e2e/
│   │   ├── jest-e2e.config.ts                ← separate config (longer timeout, different testMatch)
│   │   ├── setup.ts                          ← DB bootstrap + teardown
│   │   ├── helpers/
│   │   │   ├── auth.helper.ts                ← token factory
│   │   │   ├── request.helper.ts             ← Supertest wrappers
│   │   │   └── fixtures.ts                   ← valid payloads
│   │   ├── user.e2e-spec.ts
│   │   ├── group.e2e-spec.ts
│   │   └── ...
│   └── fixtures/
│       ├── valid-user.json
│       └── valid-group.json
scripts/
    └── live-test.ps1                         ← smoke tests
```

### Rationale

| Decision | Why |
|----------|-----|
| **Colocated unit tests** (`*.spec.ts` next to source) | Easy to find, encourages writing tests alongside code, deleted together if module is removed |
| **Separate `test/e2e/` directory** | E2E tests span multiple modules, don't belong to any single source file |
| **Separate Jest config for E2E** | Different timeout (30s vs 5s), different `testMatch` pattern (`*.e2e-spec.ts`), different setup/teardown |
| **`test/fixtures/`** | Shared JSON payloads, reusable across both E2E and unit tests |

---

## 3. Jest Configuration Strategy

### Two configs, not one

| Config | Matches | Timeout | DB |
|--------|---------|---------|-----|
| `jest.config.ts` (root) | `**/*.spec.ts` | 5s | None (mocked) |
| `test/e2e/jest-e2e.config.ts` | `**/*.e2e-spec.ts` | 30s | Real SQLite (temp file or `:memory:`) |

### Why?

- Unit tests should **never** touch a database — if they're slow, developers stop running them.
- E2E tests need a real app instance — different setup lifecycle.
- CI can run them as separate stages with independent failure reporting.

---

## 4. NPM Scripts Convention

```jsonc
{
  "test":           "jest",                                        // unit only
  "test:watch":     "jest --watch",                                // TDD loop
  "test:cov":       "jest --coverage",                             // coverage report
  "test:e2e":       "jest --config test/e2e/jest-e2e.config.ts",   // integration
  "test:smoke":     "pwsh ../scripts/live-test.ps1",               // deployed instance
  "test:ci":        "npm test && npm run test:e2e"                 // full CI gate
}
```

> **Principle:** `npm test` should always be fast. Developers run it constantly. E2E is opt-in or CI-only.

---

## 5. Test Naming Conventions

### File names

| Type | Pattern | Example |
|------|---------|---------|
| Unit | `feature.service.spec.ts` | `user.service.spec.ts` |
| Unit | `feature.controller.spec.ts` | `user.controller.spec.ts` |
| E2E | `feature.e2e-spec.ts` | `user.e2e-spec.ts` |

### Describe / It blocks

```typescript
describe('UserService', () => {
  describe('create', () => {
    it('should return a user with generated id and meta fields', () => { ... });
    it('should throw ConflictException when userName already exists', () => { ... });
    it('should set meta.created to current timestamp', () => { ... });
  });
});
```

### Rules

- `describe` = **class or method** name
- `it` = **"should" + expected behavior** (reads as an English sentence)
- **No test numbers** — names are self-documenting
- **One behavior per `it`** — multiple `expect()` is fine if they verify the same behavior

---

## 6. Test Isolation Principles

| Principle | How |
|-----------|-----|
| **Independent** | Each test creates its own data. No test depends on another's side effects. |
| **Deterministic** | No `Date.now()`, `Math.random()`, or network calls. Inject/mock time. |
| **Idempotent** | Running a test 1× or 100× produces the same result. |
| **Fast cleanup** | `beforeEach` resets state; `afterAll` drops test DB. |
| **No shared mutable state** | Avoid module-level `let user;` modified across tests. |

### E2E database strategy

```typescript
beforeEach(async () => {
  // Reset DB between tests — Prisma migrate reset or truncate all tables
  await prisma.$executeRawUnsafe(`DELETE FROM "User"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "Group"`);
});
```

Or use a **fresh SQLite file per test suite** for complete isolation.

---

## 7. Shared Test Helpers

### Auth helper (`test/e2e/helpers/auth.helper.ts`)

```typescript
export async function getAuthToken(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/scim/oauth/token')
    .send({ client_id: 'test', client_secret: 'test', grant_type: 'client_credentials' });
  return res.body.access_token;
}
```

### Request helper (`test/e2e/helpers/request.helper.ts`)

```typescript
export function scimPost(app: INestApplication, path: string, token: string, body: object) {
  return request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .set('Content-Type', 'application/scim+json')
    .send(body);
}
```

### Fixture factory (`test/e2e/helpers/fixtures.ts`)

```typescript
export const validUser = (overrides = {}) => ({
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  userName: `testuser-${Date.now()}`,
  name: { givenName: 'Test', familyName: 'User' },
  emails: [{ value: 'test@example.com', type: 'work', primary: true }],
  active: true,
  ...overrides,
});
```

### Why helpers?

- **DRY** — auth and request boilerplate written once
- **Consistent** — all tests use the same Content-Type, auth flow
- **Updatable** — change auth mechanism in one place, all tests follow

---

## 8. Coverage Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Line coverage** | ≥ 80% | Catches dead code, ensures critical paths are tested |
| **Branch coverage** | ≥ 75% | Ensures `if/else`, `switch`, error paths are exercised |
| **Function coverage** | ≥ 90% | Every exported function should have at least one test |
| **Uncovered (ok)** | Config files, DTOs, module definitions | Don't test boilerplate |

### Coverage enforcement in Jest config

```typescript
// jest.config.ts
coverageThreshold: {
  global: {
    branches: 75,
    functions: 90,
    lines: 80,
    statements: 80,
  },
},
```

---

## 9. CI Pipeline Stages

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Lint       │ →  │  Unit Tests  │ →  │  E2E Tests   │ →  │   Build     │
│  (eslint)    │    │  (jest)      │    │  (jest-e2e)  │    │  (tsc/nest) │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
                                                               ↓
                                                     ┌─────────────┐
                                                     │ Smoke Tests  │
                                                     │ (post-deploy)│
                                                     └─────────────┘
```

- **Fail fast:** Lint first (cheapest), then unit (fast), then E2E (slower).
- **Smoke:** Only after successful deployment to a staging environment.

---

## 10. Summary

| # | Recommendation |
|---|----------------|
| 1 | **Colocate** unit tests next to source files (`*.spec.ts`) |
| 2 | **Separate** E2E tests into `test/e2e/` with their own Jest config |
| 3 | **Keep `npm test` fast** — unit only, < 10 seconds |
| 4 | **Isolate every test** — own data, own cleanup, no ordering dependencies |
| 5 | **Extract helpers** — auth, request builders, and fixture factories |
| 6 | **Name tests as sentences** — `should [verb] when [condition]` |
| 7 | **Use two Jest configs** — different timeouts, matchers, and setup |
| 8 | **Enforce coverage in CI** — 80% line, 75% branch minimum |
| 9 | **Keep smoke tests thin** — verify deployment works, not exhaustive logic |
| 10 | **Fail fast in CI** — lint → unit → e2e → build → deploy → smoke |

---

## Appendix A: Resolved Issues Found During E2E Implementation

### `import type` Erases DTO Classes at Runtime (Fixed 2026-02-11)

**Problem:** Four controller files used `import type { CreateUserDto }` instead of `import { CreateUserDto }`. TypeScript's `import type` erases the class at compile time — it becomes `undefined` at runtime.

**Impact:**
- NestJS `ValidationPipe` with `transform: true` couldn't instantiate the DTO via `class-transformer`
- The request body became a plain `Function`-typed object where `name` collided with `Function.prototype.name` (a non-enumerable getter)
- `Object.keys(dto)` excluded `name`, so `extractAdditionalAttributes` never captured it → not stored in `rawPayload`
- `class-validator` decorators were never applied → missing required fields returned 500 instead of 400
- The `emails` field and other non-colliding properties worked fine, masking the bug

**Fix:** Changed `import type { ... }` → `import { ... }` for all DTO classes in:
- `endpoint-scim-users.controller.ts` — `CreateUserDto`, `PatchUserDto`
- `endpoint-scim-groups.controller.ts` — `CreateGroupDto`, `PatchGroupDto`
- `endpoint-scim.controller.ts` — all 4 DTOs
- `admin.controller.ts` — `CreateGroupDto`, `CreateUserDto`

**Lesson:** Never use `import type` for classes consumed by NestJS decorators (`@Body()`, `@Param()`) or dependency injection. The `import type` syntax is only safe for pure type annotations (interfaces, generics, function parameter/return types).
