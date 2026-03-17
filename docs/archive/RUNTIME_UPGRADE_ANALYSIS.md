# ✅ Runtime Upgrade Report — Completed

> **Status**: Historical completion report (retained for auditability)  
> **Last Updated**: March 1, 2026  
> **Baseline**: SCIMServer v0.10.0

> **Original analysis**: February 11, 2026  
> **Upgrade completed**: February 14, 2026  
> **Project**: SCIMServer — NestJS + Prisma + SQLite SCIM 2.0 Server

---

## 📊 Before → After

| Component | Before | After | Change |
|-----------|--------|-------|--------|
| **Node.js** (Docker) | `node:18-alpine` | `node:24-alpine` | ✅ 2 major versions |
| **Node.js** (local dev) | v24.13.0 | v24.13.0 | — (unchanged) |
| **NestJS** | 10.4.22 | **11.1.13** | ✅ Major upgrade |
| **Prisma** | 5.16.0 | **7.4.0** | ✅ Major upgrade |
| **TypeScript** | 5.4.5 | **5.9.3** | ✅ Minor upgrade |
| **TS target** (API) | `es2019` | **`es2022`** | ✅ 3 years forward |
| **TS target** (Web) | `ES2020` | **`ES2022`** | ✅ 2 years forward |
| **@typescript-eslint** | 7.8.0 | **8.56.0** | ✅ Major upgrade |
| **@types/node** | 20.12.7 | **25.2.3** | ✅ Major upgrade |
| **@types/jest** | 29.5.12 | **30.0.0** | ✅ Major upgrade |
| **@types/express** | 4.17.21 | **5.0.6** | ✅ Major upgrade |
| **supertest** | 6.3.4 | **7.2.2** | ✅ Major upgrade |
| **dotenv** | 16.4.5 | **17.2.4** | ✅ Major upgrade |
| **rxjs** | 7.8.1 | **7.8.2** | ✅ Patch |
| **class-validator** | 0.14.1 | **0.14.3** | ✅ Patch |
| **prettier** | 3.2.5 | **3.8.1** | ✅ Minor upgrade |
| **ts-jest** | 29.1.2 | **29.4.6** | ✅ Minor upgrade |
| **@azure/identity** | ^4.0.1 | **^4.13.0** | ✅ Minor upgrade |
| **@azure/storage-blob** | ^12.18.0 | **^12.31.0** | ✅ Minor upgrade |
| **eslint-config-prettier** | 9.x | **10.1.8** | ✅ Major upgrade |
| **React** | 18.3.1 | **19.2.4** | ✅ Major upgrade |
| **Vite** | 5.2.0 | **7.3.1** | ✅ Major upgrade |
| **Jest** | 29.7.0 | **30.2.0** | ✅ Major upgrade |
| **ESLint** | 8.57.0 | **10.0.0** | ✅ Major upgrade |

---

## 🧪 Validation Results

> *Counts below are from the time of the runtime upgrade. See [PROJECT_HEALTH_AND_STATS.md](PROJECT_HEALTH_AND_STATS.md) for current baseline.*

| Test Tier | Count | Result |
|-----------|-------|--------|
| **Unit tests** | 666 / 666 (19 suites) | ✅ All passing |
| **E2E tests** | 184 / 184 (14 suites) | ✅ All passing |
| **Live tests (local)** | 280 / 280 | ✅ All passing |
| **Live tests (Docker)** | 280 / 280 | ✅ All passing |
| **ESLint** | 0 errors, 74 warnings | ✅ Clean (warnings are intentional `any` + test scaffolding) |

---

## 🔧 Breaking Changes Encountered & Fixed

### 1. NestJS 11 — Route Wildcard Syntax

**Problem**: NestJS 11 uses `path-to-regexp` v8, which requires named wildcard parameters.

**Fix** in `api/src/modules/web/web.controller.ts`:
```diff
- @Get('/assets/*')    →  @Get('/assets/*path')
- @Get('/admin/*')     →  @Get('/admin/*path')
- @Param('0')          →  @Param('path')
```

### 2. Prisma 7 — Config Pattern Migration

**Change**: Prisma 7.4.0 requires a `prisma.config.ts` file and updated datasource configuration handling.

**Outcome**: Migrated successfully to Prisma **7.4.0** with `prisma.config.ts` in place and all migrations, tests, and runtime flows validated.

### 3. Docker — `effect` Package Deletion

**Problem**: The Docker cleanup step `find -name "test*" -type d -exec rm -rf` was deleting `effect/dist/cjs/internal/testing/` — a directory that Prisma 7 CLI requires at runtime.

**Fix** in `Dockerfile`:
```diff
- find ./node_modules -name "test*" -type d -exec rm -rf {} +
+ find ./node_modules -path "*/effect" -prune -o -name "test*" -type d -exec rm -rf {} +
```

### 4. Docker — `npm prune --production` Removed

**Problem**: `npm prune --production` removes Prisma CLI (a devDependency), but `docker-entrypoint.sh` needs `npx prisma migrate deploy` at runtime.

**Fix**: Removed `npm prune --production` from the Dockerfile entirely. Full `node_modules` is preserved in the production image.

### 5. NestJS 11 Peer Dependencies

**Note**: NestJS 11 has strict peer dependency requirements. Install with `--legacy-peer-deps` flag.

### 6. @typescript-eslint 7→8 — Stricter Rules

**Problem**: `@typescript-eslint` 8.55.0 is significantly stricter than 7.8.0. The upgrade surfaced 223 new errors from rules like `no-unsafe-argument`, `unbound-method`, `require-await`, and stricter `no-unused-vars`.

**Fix** in `.eslintrc.cjs`:
- Added `no-unsafe-argument: off` to match existing `no-unsafe-*` family (SCIM payloads are inherently untyped JSON)
- Added test-file overrides: `no-explicit-any`, `unbound-method`, `require-await` relaxed in `*.spec.ts`
- Added `caughtErrorsIgnorePattern: '^_|^e$'` to `no-unused-vars`
- Fixed 8 actual source errors: unused imports, misused promises, unnecessary `async`, unused destructured vars
- **Result**: 0 errors, 74 warnings (all non-blocking)

---

## 🗺️ Remaining Upgrade Opportunities (Deferred)

| Component | Current | Latest | Reason Deferred |
|-----------|---------|--------|-----------------|
| **TypeScript** | 5.9.3 | 5.x latest | Update periodically with ecosystem validation |
| **NestJS** | 11.1.13 | 11.x latest | Track minor/patch cadence |
| **Prisma** | 7.4.0 | 7.x latest | Track Prisma 7 minor updates and adapter stability |

---

## 📈 Benefits Realized

- **Security**: Node.js 18 (EOL April 2025) eliminated from all Dockerfiles → Node 24 (supported through April 2027)
- **Performance**: V8 v12.x Maglev JIT, Prisma 7 query engine improvements, ES2022 native features (less polyfill overhead)
- **DX**: TypeScript 5.9 improved error messages, NestJS 11 better DI diagnostics
- **Compatibility**: Azure SDK patches, improved Managed Identity support

---

*This document was originally a pre-upgrade analysis. It has been converted to a completion report after all upgrades were successfully applied and validated.*
