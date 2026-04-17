---
description: "Audit all error handling paths — exception filters, RepositoryError, diagnostics, SCIM compliance, auth errors, bulk isolation"
mode: "agent"
---

Go through all error handling code paths in the SCIMServer codebase to verify completeness and correctness. Use the detailed checklist in #file:docs/PROMPT_ERROR_HANDLING_VERIFICATION.md as the audit guide.

## System Context

The error handling system has these components:
- `createScimError()` factory in `scim-errors.ts` — produces `HttpException` with SCIM body + diagnostics extension (requestId, endpointId, triggeredBy, logsUrl, errorCode)
- `ScimExceptionFilter` (`@Catch(HttpException)`) — formats SCIM error responses, auto-enriches ALL HttpExceptions with diagnostics from correlation context, tiered logging (5xx→ERROR, 401/403→WARN, 404→DEBUG, 4xx→INFO)
- `GlobalExceptionFilter` (`@Catch()`) — catch-all for non-HttpException errors, returns SCIM 500 with generic message, no info leakage
- `RepositoryError` domain boundary — typed codes: NOT_FOUND, CONFLICT, CONNECTION, UNKNOWN
- `handleRepositoryError()` shared helper in `scim-service-helpers.ts` — catches RepositoryError, logs ERROR, re-throws as createScimError
- `PatchError` domain exception — caught by services, converted to createScimError with failedOperationIndex/failedPath/failedOp
- Diagnostics extension URN: `urn:scimserver:api:messages:2.0:Diagnostics`
- Enriched correlation context via `AsyncLocalStorage`: requestId, endpointId, authType, resourceType, resourceId, operation, bulkOperationIndex
- **82 endpoints across 19 controllers** — all SCIM routes produce SCIM-compliant error bodies

## Audit Checklist (Sections A–J)

For each error path section, trace the actual code and report ✅ PASS / ⚠️ PARTIAL / ❌ FAIL:

### A. Repository Layer Errors
For EACH repository (User, Group, Generic):
1. `repo.create()` fails → verify RepositoryError wrapping
2. `repo.update()` on nonexistent ID → verify RepositoryError NOT_FOUND → 404
3. `repo.delete()` on nonexistent ID → verify RepositoryError NOT_FOUND → 404
4. `repo.update()` connection timeout → verify RepositoryError CONNECTION → 503
5. `repo.create()` unique constraint (Prisma P2002) → verify RepositoryError CONFLICT → 409
6. Verify InMemory and Prisma repos both produce RepositoryError (not raw Error)
7. Verify `wrapPrismaError()` handles P2025, P2002, P1001, P1002, P1008, P1017
8. Verify unknown Prisma errors map to UNKNOWN → 500

### B. Service Layer Error Handling
For EACH service (Users, Groups, Generic):
1. Resource not found (findByScimId returns null) → createScimError 404/noTarget
2. Uniqueness conflict (findConflict returns match) → createScimError 409/uniqueness
3. Missing required schema (ensureSchema) → createScimError 400/invalidSyntax
4. RepositoryError caught → handleRepositoryError → logger.error + createScimError
5. PatchError caught → createScimError with err.status/err.scimType
6. Non-PatchError re-thrown → reaches GlobalExceptionFilter
7. enforceIfMatch missing header + RequireIfMatch=ON → createScimError 428
8. enforceIfMatch ETag mismatch → createScimError 412/versionMismatch
9. Schema validation failure → createScimError 400 + diagnostics.triggeredBy=StrictSchemaValidation
10. Immutable attribute violation → createScimError 400/mutability (G1: now unconditional, no triggeredBy)
11. Extension URN not declared → createScimError 400/invalidSyntax + diagnostics.triggeredBy
12. Extension URN not registered → createScimError 400/invalidValue + diagnostics.triggeredBy
13. Required attribute missing (G2: now unconditional) → createScimError 400/invalidValue
14. Filter validation failure → createScimError 400/invalidFilter + diagnostics.triggeredBy

### C. Exception Filter Chain
1. HttpException from createScimError → ScimExceptionFilter → SCIM body preserved
2. HttpException from NestJS (BadRequestException) → ScimExceptionFilter → wrapped in SCIM envelope
3. Raw Error (e.g., InMemory repo before RepositoryError) → GlobalExceptionFilter → SCIM 500
4. TypeError from PatchEngine → GlobalExceptionFilter → SCIM 500
5. PrismaClientKnownRequestError bypassing service catch → GlobalExceptionFilter → SCIM 500
6. Non-SCIM route error → both filters return NestJS-style JSON (not SCIM format)
7. 5xx → logger.error in ScimExceptionFilter
8. 401/403 → logger.warn in ScimExceptionFilter
9. 404 → logger.debug in ScimExceptionFilter
10. 400/409/412/428 → logger.info in ScimExceptionFilter

### D. Diagnostics Extension Completeness
For EACH throw site that uses createScimError:
1. Verify `diagnostics.triggeredBy` is set where a config flag gates the validation
2. Verify `diagnostics.requestId` is auto-populated from correlation context
3. Verify `diagnostics.endpointId` is auto-populated when available
4. Verify `diagnostics.logsUrl` points to endpoint-scoped path (not admin)
5. Verify `diagnostics.logsUrl` falls back to admin path when no endpointId
6. Verify diagnostics is NOT present when called outside request scope (no correlation context)

### E. Auth Error Handling
1. Missing Authorization header → 401 UnauthorizedException with SCIM body + WWW-Authenticate header
2. Invalid bearer token (all 3 auth methods fail) → 401 with SCIM body
3. OAuth token expired → 401 (falls through to legacy, then rejects)
4. Per-endpoint credential check error → caught, falls through (DEBUG log), NOT 500
5. SCIM_SHARED_SECRET missing in production → FATAL log + 401
6. Inactive endpoint → 403 ForbiddenException

### F. Bulk Error Isolation
1. Individual operation failure → caught by BulkProcessor, WARN logged, operation result includes error
2. Individual operation failure → does NOT abort entire bulk request (unless failOnErrors)
3. failOnErrors threshold → stops processing, remaining ops not attempted
4. Error result includes SCIM error body (schemas, detail, scimType, status)
5. Non-HttpException in bulk operation → caught, mapped to 500, does NOT crash the bulk

### G. Admin API Error Handling
1. Endpoint not found → 404 NotFoundException (NestJS format, not SCIM)
2. Duplicate endpoint name → 400 BadRequestException
3. Invalid endpoint config → 400 BadRequestException with validation message
4. Invalid preset name → 400 BadRequestException
5. Invalid log category → 400 HttpException
6. Credential not found → 404 NotFoundException
7. PerEndpointCredentials not enabled → 403 ForbiddenException

### H. Content-Type & Middleware Errors
1. Wrong Content-Type on POST/PUT/PATCH → 415 via createScimError
2. No Content-Type + empty body → pass through (not rejected)
3. application/json accepted (RFC 7644 backward compat)
4. application/scim+json accepted

### I. Error Response Format Compliance
1. Every SCIM error → `schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"]`
2. Every SCIM error → `status` is a string (not number) per RFC 7644 §3.12
3. Every SCIM error → `Content-Type: application/scim+json; charset=utf-8`
4. Every SCIM error → `detail` is a non-empty string
5. Every SCIM error → `scimType` present where applicable
6. Every SCIM error → no internal details leaked (no stack traces, no SQL, no DB URLs)
7. Every SCIM error on endpoint route → `X-Request-Id` header present
8. Client-supplied `X-Request-Id` → propagated to response header AND diagnostics.requestId

### J. Data Corruption & Edge Cases
1. Corrupt rawPayload (invalid JSON) → WARN log + graceful fallback to {}
2. Corrupt meta (invalid JSON) → WARN log + graceful fallback to {}
3. Null/undefined thrown value → GlobalExceptionFilter handles without crash
4. String thrown value → GlobalExceptionFilter handles without crash
5. Circular reference in error object → does not crash JSON.stringify in logger
6. Very large error message → does not crash response serialization

## Key Source Files to Read

| File | Purpose |
|------|---------|
| `api/src/modules/scim/common/scim-errors.ts` | `createScimError()` factory + `ScimErrorDiagnostics` interface |
| `api/src/modules/scim/filters/scim-exception.filter.ts` | `ScimExceptionFilter` — SCIM error formatting + diagnostics auto-enrichment |
| `api/src/modules/scim/filters/global-exception.filter.ts` | `GlobalExceptionFilter` — catch-all for non-HttpException |
| `api/src/modules/scim/common/scim-service-helpers.ts` | `handleRepositoryError()`, `enforceIfMatch()`, `ensureSchema()` |
| `api/src/domain/errors/repository-error.ts` | `RepositoryError` class with typed codes |
| `api/src/infrastructure/repositories/prisma/prisma-error.util.ts` | `wrapPrismaError()` — Prisma error code → RepositoryError mapping |
| `api/src/domain/patch/patch-error.ts` | `PatchError` class |
| `api/src/modules/scim/services/endpoint-scim-users.service.ts` | Users service — all error paths |
| `api/src/modules/scim/services/endpoint-scim-groups.service.ts` | Groups service — all error paths |
| `api/src/modules/scim/services/endpoint-scim-generic.service.ts` | Generic service — all error paths |
| `api/src/modules/scim/services/bulk-processor.service.ts` | Bulk error isolation |
| `api/src/modules/auth/shared-secret.guard.ts` | Active auth guard (3-tier chain) |
| `api/src/modules/scim/interceptors/scim-content-type.interceptor.ts` | Content-Type validation |

## Output Format

For each error path, report:
- **✅ PASS**: error caught, correct status, SCIM-compliant body, diagnostics present, log at right level
- **⚠️ PARTIAL**: error handled but missing diagnostics/wrong level/wrong status
- **❌ FAIL**: error uncaught, non-SCIM response, internal details leaked, no log

### K. Response Body Integrity

| Check | Description |
|-------|-------------|
| K.1 | Map/Set objects never appear in JSON API responses (they serialize to `{}`) |
| K.2 | Internal runtime fields (`_schemaCaches`, `_prismaMetadata`, etc.) never appear in API responses |
| K.3 | Error response bodies contain ONLY documented SCIM Error fields (`schemas`, `status`, `scimType`, `detail`, diagnostics URN) |
| K.4 | Admin endpoint responses strip profile `_schemaCaches` in `toFullResponse()` |
| K.5 | Profile serialization produces only `schemas`, `settings`, `resourceTypes`, `serviceProviderConfig` |
| K.6 | `getExtensionUrns()` returns only extensions for the matching resource type (no cross-contamination) |

At the end, produce:
1. A severity-sorted list of all failures and partials
2. Specific file:line locations that need fixing
3. Test cases to add (unit/E2E/live) for each uncovered error path
4. Any new error patterns discovered that aren't in this checklist

## Self-Improvement Rules

After each audit run:
1. Add any NEW error paths discovered during code reading
2. Add specific file:line references for each checkpoint
3. Track which error paths have test coverage vs code-verified only
4. If untested, write the specific test assertion needed
5. Remove paths that have comprehensive test coverage
6. Check for any new `throw` statements added since last audit
7. Update the pass rate and date in the PROMPT_ERROR_HANDLING_VERIFICATION.md header
