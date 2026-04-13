# Self-Improving Error Handling Verification Prompt

> **Last audit run**: April 13, 2026  
> **Pass rate**: 70/73 PASS, 3 PARTIAL (Prisma create() wrapping — race-condition defense-in-depth)  
> **Version**: 1.1 · April 13, 2026

## Context
You are auditing SCIMServer's error handling completeness. The system has:
- `createScimError()` factory with diagnostics extension (requestId, endpointId, triggeredBy, logsUrl)
- `ScimExceptionFilter` (@Catch(HttpException)) — SCIM error formatting for HttpException
- `GlobalExceptionFilter` (@Catch()) — catch-all for non-HttpException errors (raw Error, TypeError, PrismaError)
- `RepositoryError` domain boundary — typed codes: NOT_FOUND, CONFLICT, CONNECTION, UNKNOWN
- `handleRepositoryError()` shared helper — catches RepositoryError, logs ERROR, re-throws as createScimError
- `PatchError` domain exception — caught by services, converted to createScimError
- Multiple error creation patterns: createScimError, BadRequestException, NotFoundException, UnauthorizedException, raw Error
- RFC 7644 §3.12 compliance: status as string, schemas array, Content-Type: application/scim+json

## Task
Walk through EVERY error path listed below. For each:
1. Trace the exact throw site → catch site → filter → HTTP response
2. Verify the response is SCIM-compliant (schemas, detail, status as string, correct Content-Type)
3. Verify the diagnostics extension is present with requestId, endpointId, triggeredBy, logsUrl
4. Verify logsUrl uses endpoint-scoped path when endpointId is available
5. Verify a log entry is produced at the correct level BEFORE the throw
6. Verify the error does NOT leak internal details (stack traces, DB credentials, SQL) to the client
7. Verify InMemory and Prisma backends produce identical error responses for the same scenario

## Error Paths to Audit

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
  10. Immutable attribute violation → createScimError 400/mutability + diagnostics.triggeredBy
  11. Extension URN not declared → createScimError 400/invalidSyntax + diagnostics.triggeredBy
  12. Extension URN not registered → createScimError 400/invalidValue + diagnostics.triggeredBy
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
  5. Invalid log category → 400 HttpException (since Step 12)
  6. Credential not found → 404 NotFoundException
  7. PerEndpointCredentials not enabled → 403 ForbiddenException

### H. Content-Type & Middleware Errors
  1. Wrong Content-Type on POST/PUT/PATCH → 415 via createScimError (since Step 12)
  2. No Content-Type + empty body → pass through (not rejected)
  3. application/json accepted (RFC 7644 backward compat)
  4. application/scim+json accepted

### I. Error Response Format Compliance
  1. Every SCIM error → `schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"]`
  2. Every SCIM error → `status` is a string (not number) per RFC 7644 §3.12
  3. Every SCIM error → `Content-Type: application/scim+json; charset=utf-8`
  4. Every SCIM error → `detail` is a non-empty string
  5. Every SCIM error → `scimType` present where applicable (uniqueness, noTarget, invalidFilter, etc.)
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

## Output Format
For each error path, report:
- ✅ PASS: error caught, correct status, SCIM-compliant body, diagnostics present, log at right level
- ⚠️ PARTIAL: error handled but missing diagnostics/wrong level/wrong status
- ❌ FAIL: error uncaught, non-SCIM response, internal details leaked, no log

At the end, produce:
1. A severity-sorted list of all failures and partials
2. Specific file:line locations that need fixing
3. Test cases to add (unit/E2E/live) for each uncovered error path
4. Any new error patterns discovered that aren't in this checklist

## Self-Improvement Rules
After each audit run:
1. Add any NEW error paths discovered during code reading that weren't in this list
2. Add specific file:line references for each checkpoint so future runs are faster
3. Track which error paths have test coverage vs which are only code-verified
4. If a path is found to be untested, write the specific test assertion needed
5. Remove paths that have comprehensive test coverage and will never regress
6. Note any error messages that could be improved for RCA clarity
7. Check for any new `throw` statements added since the last audit run
8. Update the pass rate and date in the header

## Session Memory
After completing the audit, update Session_starter.md with:
- Date of last error handling audit
- Pass rate (X/Y)
- Any new gaps discovered (assign gap numbers G30+)
- Any error paths added to this prompt
