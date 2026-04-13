# Error Handling Verification Prompt (Self-Improving)

> **Version:** 3.0 · **Source-verified against:** v0.34.0 · **Regenerated:** April 13, 2026  
> Automated checklist — run against source to verify error handling completeness.

---

## Purpose

This is a **self-improving audit prompt** for verifying that SCIMServer's error handling is complete, RFC-compliant, and correctly implemented across all SCIM operations. Run periodically or after major changes.

---

## Verification Checklist

### 1. SCIM Error Format Compliance (RFC 7644 §3.12)

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 1.1 | `schemas` array present in all error responses | Check both filters + factory | `[SCIM_ERROR_SCHEMA]` |
| 1.2 | `status` is always a string (not number) | Check both filters + factory | `String(status)` coercion |
| 1.3 | `Content-Type: application/scim+json` on all SCIM errors | Check both filters | Header set with `charset=utf-8` |
| 1.4 | `scimType` uses RFC 7644 Table 9 vocabulary | Check `SCIM_ERROR_TYPE` in `scim-constants.ts` | 9 defined types |
| 1.5 | `detail` field always present | Check factory + filters | Always populated |

### 2. Exception Filter Chain

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 2.1 | Two filters registered: Global + Scim | Check `scim.module.ts` APP_FILTER | Both registered |
| 2.2 | Registration order: Global first, Scim second | Check provider array order | Global → Scim (Scim runs first due to NestJS reverse order) |
| 2.3 | Global catches non-HttpException | Check `@Catch()` without type | Yes |
| 2.4 | Global re-throws HttpException to Scim filter | Check `if (instanceof HttpException) throw` | Yes |
| 2.5 | Scim catches only HttpException | Check `@Catch(HttpException)` | Yes |
| 2.6 | Non-SCIM routes get NestJS-style errors | Check `url.startsWith('/scim')` in both | Both check |

### 3. Diagnostics Extension

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 3.1 | Extension URN defined | Check `scim-constants.ts` | `urn:scimserver:api:messages:2.0:Diagnostics` |
| 3.2 | Auto-enriched in `createScimError()` | Check factory code | Reads `getCorrelationContext()` |
| 3.3 | Fallback enrichment in ScimExceptionFilter | Check filter | Adds diagnostics if not present (G.4) |
| 3.4 | Enrichment in GlobalExceptionFilter | Check filter | Adds diagnostics from context |
| 3.5 | `logsUrl` points to correct endpoint | Check URL computation | Endpoint-scoped or admin, based on `endpointId` |
| 3.6 | 14+ diagnostic fields supported | Check `ScimErrorDiagnostics` interface | requestId, endpointId, triggeredBy, errorCode, operation, attributePath, schemaUrn, conflictingResourceId, conflictingAttribute, incomingValue, failedOperationIndex, failedPath, failedOp, currentETag, parseError |

### 4. Domain Error Layer

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 4.1 | `RepositoryError` has 4 typed codes | Check `repository-error.ts` | NOT_FOUND, CONFLICT, CONNECTION, UNKNOWN |
| 4.2 | Cause chain preserved | Check constructor | `cause.stack` appended to `this.stack` |
| 4.3 | Code → HTTP status mapping | Check `repositoryErrorToHttpStatus` | 404, 409, 503, 500 |
| 4.4 | `wrapPrismaError()` handles all Prisma codes | Check `prisma-error.util.ts` | P2025, P2002, P1001, P1002, P1008, P1017 |
| 4.5 | `wrapPrismaError()` handles connection patterns | Check message matching | `connect`, `timed out`, `ECONNREFUSED` |
| 4.6 | `PatchError` carries operation context | Check `patch-error.ts` | operationIndex, failedPath, failedOp |

### 5. Service Layer Bridge

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 5.1 | `handleRepositoryError()` logs at ERROR | Check helper function | `logger.error(...)` for RepositoryError |
| 5.2 | `handleRepositoryError()` uses `createScimError()` | Check throw | Yes, with mapped status |
| 5.3 | Non-RepositoryError re-thrown | Check else branch | `throw error` — to GlobalExceptionFilter |
| 5.4 | All SCIM services use `handleRepositoryError()` | Grep service files | Users, Groups, Generic — all use it |

### 6. HTTP Status Code Coverage

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 6.1 | 400 Bad Request | Check for createScimError with 400 | Used for invalidSyntax, invalidPath, invalidValue, etc. |
| 6.2 | 401 Unauthorized | Check auth guard | SharedSecretGuard throws 401 |
| 6.3 | 404 Not Found | Check services | Repository NOT_FOUND → 404 |
| 6.4 | 409 Conflict | Check uniqueness validation | Repository CONFLICT → 409 |
| 6.5 | 412 Precondition Failed | Check ETag interceptor | If-Match mismatch → 412 |
| 6.6 | 415 Unsupported Media Type | Check middleware | Content-Type validation → 415 |
| 6.7 | 500 Internal Server Error | Check GlobalExceptionFilter | Catch-all → 500 |
| 6.8 | 503 Service Unavailable | Check CONNECTION error mapping | repositoryErrorToHttpStatus('CONNECTION') → 503 |

### 7. Log Level Consistency

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 7.1 | 5xx logged at ERROR | Check interceptor + filter | Both use ERROR for 5xx |
| 7.2 | 401/403 logged at WARN | Check interceptor + filter | Both use WARN |
| 7.3 | 404 logged at DEBUG | Check interceptor + filter | Both use DEBUG |
| 7.4 | Other 4xx logged at INFO | Check interceptor + filter | Both use INFO |
| 7.5 | Match between interceptor and filter tiering | Compare both implementations | Identical logic |

### 8. Sensitive Data Protection

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 8.1 | Internal error details not in 500 responses | Check GlobalExceptionFilter body | Generic "Internal server error" |
| 8.2 | Stack traces not in HTTP responses | Check both filters | Never included in response body |
| 8.3 | Credential data not in error responses | Check createScimError | No credential fields in diagnostics |
| 8.4 | Stack traces configurable in logs | Check `includeStackTraces` flag | Yes, via config |

### 9. Content-Type Validation

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 9.1 | POST/PUT/PATCH validated | Check middleware | `BODY_METHODS` set |
| 9.2 | Accepts application/json | Check `ACCEPTED_TYPES` | Yes |
| 9.3 | Accepts application/scim+json | Check `ACCEPTED_TYPES` | Yes |
| 9.4 | Charset tolerance | Check `contentType.includes(t)` | Handles `; charset=utf-8` |
| 9.5 | Empty body bypass | Check middleware | Allows missing Content-Type on empty body |

### 10. Authentication Error Handling

| # | Check | How to Verify | Expected |
|---|-------|---------------|----------|
| 10.1 | Missing header → 401 | Check guard | WARN log + reject |
| 10.2 | All auth failed → 401 | Check guard | WARN log + reject |
| 10.3 | Missing secret in prod → FATAL + 401 | Check guard | FATAL log + reject |
| 10.4 | Missing secret in dev → auto-generate | Check guard | WARN log + generated |
| 10.5 | Auth success → INFO | Check guard | INFO for all 3 auth types |
| 10.6 | Context enriched with authType | Check guard | enrichContext() for oauth, legacy, endpoint_credential |

---

## Execution Results Template

```
Date: YYYY-MM-DD
Version: x.y.z
Executor: [human/AI]

Section 1 (SCIM Format): __/5 PASS
Section 2 (Filter Chain): __/6 PASS
Section 3 (Diagnostics): __/6 PASS
Section 4 (Domain Errors): __/6 PASS
Section 5 (Service Bridge): __/4 PASS
Section 6 (Status Codes): __/8 PASS
Section 7 (Log Levels): __/5 PASS
Section 8 (Data Protection): __/4 PASS
Section 9 (Content-Type): __/5 PASS
Section 10 (Auth Errors): __/6 PASS

TOTAL: __/55 PASS
```

---

## Latest Run

```
Date: April 13, 2026
Version: 0.34.0
Executor: AI (Claude Opus 4.6, source-verified)

Section 1 (SCIM Format): 5/5 PASS
Section 2 (Filter Chain): 6/6 PASS
Section 3 (Diagnostics): 6/6 PASS
Section 4 (Domain Errors): 6/6 PASS
Section 5 (Service Bridge): 4/4 PASS
Section 6 (Status Codes): 8/8 PASS
Section 7 (Log Levels): 5/5 PASS
Section 8 (Data Protection): 4/4 PASS
Section 9 (Content-Type): 5/5 PASS
Section 10 (Auth Errors): 6/6 PASS

TOTAL: 55/55 PASS
```

All checks verified against actual source files.
