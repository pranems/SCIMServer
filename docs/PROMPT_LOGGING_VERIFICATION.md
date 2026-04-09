# Self-Improving Logging & Error Handling Verification Prompt

> **Last audit run**: April 8, 2026  
> **Pass rate**: 85/85 (100% after fixes)  
> **Version**: 2.0 - April 8, 2026

## Context
You are auditing SCIMServer's logging and error handling. The system has:
- 14 config flags per endpoint (StrictSchemaValidation, SoftDeleteEnabled, VerbosePatchSupported, RequireIfMatch, logFileEnabled, etc.)
- 6 profile presets (entra-id, entra-id-minimal, rfc-standard, minimal, user-only, lexmark)
- 2 persistence backends (Prisma/PostgreSQL, InMemory)
- 3 SCIM services (Users, Groups, Generic/Custom)
- Bulk operations (RFC 7644 S3.7)
- 3-tier auth (per-endpoint credentials, OAuth JWT, legacy bearer)
- Diagnostics extension (urn:scimserver:api:messages:2.0:Diagnostics) in ALL error responses with:
  - requestId, endpointId, logsUrl (auto-enriched from correlation context)
  - errorCode (machine-readable: UNIQUENESS_USERNAME, VALIDATION_SCHEMA, FILTER_INVALID, etc.)
  - triggeredBy (config flag that activated the validation path)
  - operation (auto-read from correlation context: create/replace/patch/delete)
  - conflictingResourceId, conflictingAttribute, incomingValue (409 uniqueness errors)
  - failedOperationIndex, failedPath, failedOp (PATCH errors)
  - parseError (filter syntax errors), currentETag (428 precondition errors)
- Enriched correlation context (requestId, endpointId, authType, resourceType, resourceId, operation, bulkOperationIndex)
- 14 log categories, 7 levels, per-endpoint/per-category level overrides, runtime-configurable slowRequestThresholdMs
- File logging: RotatingFileWriter + FileLogTransport (main logs/scimserver.log + per-endpoint files via logFileEnabled)
- Ring buffer: 2000 entries default (configurable via LOG_RING_BUFFER_SIZE)
- Interceptor: tiered log levels in catchError (5xx->ERROR, 401/403->WARN, 404->DEBUG, 4xx->INFO)
- Config change audit: before/after values logged, GET /admin/log-config/audit endpoint
- Log retention: POST /admin/logs/prune?retentionDays=30
- Endpoint DB logs: GET /endpoints/:id/logs/history (persistent request log access for tenants)
- Duration filter: GET /admin/logs?minDurationMs=5000
- All 50 createScimError calls have diagnostics with errorCode (100% coverage)
- 0 silent catches in SCIM core (15 utility catches have TRACE/DEBUG logs)

## Task
Walk through EVERY code path and flow listed below. For each path:
1. Trace the exact code execution from controller → service → repository
2. Verify a log entry is produced at the correct level and category
3. Verify errors produce SCIM-compliant responses with diagnostics extension
4. Verify the correlation context carries the right fields at each point
5. Verify silent catches have WARN/DEBUG logging
6. Note any path that is MISSING a log, has the WRONG level, or produces a non-SCIM error

## Flows to Audit

### A. CRUD Operations × Resource Types × Config Flags
For EACH of (Users, Groups, Generic/Custom):
  For EACH of (POST create, GET single, GET list, PUT replace, PATCH, DELETE):
    1. Happy path → verify pre-op intent log (INFO/DEBUG) AND post-op completion log with correct category
       - File refs: `endpoint-scim-users.service.ts`, `endpoint-scim-groups.service.ts`, `endpoint-scim-generic.service.ts`
    2. Resource not found → verify 404 with diagnostics
    3. Uniqueness conflict → verify 409 with diagnostics
    4. Repository error (connection timeout) → verify ERROR log + 503 with diagnostics
    5. Repository error (not found on update/delete) → verify ERROR log + 404
  ✅ All 18 methods verified: enrichContext, handleRepositoryError, diagnostics, pre/post-op logs

### B. Config Flag Combinations
For EACH of these flag combinations:
  1. StrictSchemaValidation=ON + AllowAndCoerceBooleanStrings=ON → POST with "True" string
  2. StrictSchemaValidation=ON + AllowAndCoerceBooleanStrings=OFF → POST with "True" string
  3. StrictSchemaValidation=ON → POST with wrong type → verify diagnostics.triggeredBy="StrictSchemaValidation"
  4. StrictSchemaValidation=ON → POST with unregistered extension URN → verify triggeredBy
  5. StrictSchemaValidation=ON + IgnoreReadOnlyAttributesInPatch=ON → PATCH readOnly attr → verify WARN strip log
  6. StrictSchemaValidation=ON + IgnoreReadOnlyAttributesInPatch=OFF → PATCH readOnly attr → verify 400
  7. SoftDeleteEnabled=ON → DELETE → verify INFO soft-delete log
  8. SoftDeleteEnabled=ON → GET deleted resource → verify DEBUG guardSoftDeleted + 404
  9. SoftDeleteEnabled=ON + ReprovisionOnConflict=ON → POST duplicate of soft-deleted → verify INFO reprovision
  10. RequireIfMatch=ON → PUT without If-Match → verify 428 with diagnostics.triggeredBy="RequireIfMatch"
  11. RequireIfMatch=ON → PUT with wrong ETag → verify 412
  12. VerbosePatchSupported=ON → PATCH with dot-notation path
  13. PerEndpointCredentialsEnabled=ON → auth with per-endpoint token → verify enrichContext(authType)

### C. Bulk Operations (`bulk-processor.service.ts`)
  1. Bulk with all success → verify INFO start + INFO complete + per-operation enrichContext(bulkOperationIndex)
  2. Bulk with partial failure → verify WARN per failed op with bulkIndex + INFO complete with errors count
  3. Bulk with failOnErrors threshold → verify stopped=true in complete log
  4. Bulk with bulkId cross-reference → verify DEBUG resolution log (resolveBulkIdInString L358)
  5. Bulk with DB error on one operation → verify ERROR log with bulkIndex via enrichContext propagation
  ✅ All 5 verified (C.4 fixed: added DEBUG log for bulkId resolution)

### D. Auth Flows
  1. OAuth JWT success → verify INFO + enrichContext(authType='oauth')
  2. Legacy bearer success → verify INFO + enrichContext(authType='legacy')
  3. Per-endpoint credential success → verify INFO + enrichContext(authType='endpoint_credential', authCredentialId)
  4. Auth failure (invalid token) → verify WARN
  5. Missing Authorization header → verify WARN
  6. SCIM_SHARED_SECRET not configured in production → verify FATAL

### E. Admin Operations (`log-config.controller.ts`, `endpoint.service.ts`, `admin-credential.controller.ts`)
  1. PUT /admin/log-config → verify INFO audit log with changed field keys
  2. PUT /admin/log-config/level/:level → verify INFO audit log
  3. PUT /admin/log-config/category/:cat/:level → verify INFO audit log
  4. PUT /admin/log-config/category/invalid/:level → verify 400 HttpException
  5. Endpoint create → verify INFO audit log with endpointId, name, preset (both InMemory + Prisma)
  6. Endpoint update → verify INFO audit log (both InMemory + Prisma)
  7. Endpoint delete → verify INFO audit log (both InMemory + Prisma paths)
  8. Credential create → verify INFO audit log with credentialId
  9. Credential revoke → verify INFO audit log
  ✅ All 9 verified (E.5/E.6 fixed: added audit logs for InMemory create/update paths)

### F. Endpoint-Scoped Log Access
  1. GET /endpoints/:id/logs/recent → verify auto-filtered by endpointId
  2. GET /endpoints/:id/logs/recent?level=WARN → verify level filter
  3. GET /endpoints/:id/logs/recent?category=scim.user → verify category filter
  4. GET /endpoints/:id/logs/stream → verify SSE connected event with endpointId
  5. GET /endpoints/:id/logs/download → verify NDJSON with attachment header
  6. Verify entries from other endpoints are NOT returned

### G. Error Response Format (`scim-exception.filter.ts`, `global-exception.filter.ts`, `scim-errors.ts`)
  1. Every 4xx on /scim/* → verify Content-Type: application/scim+json
  2. Every error → verify status is string per RFC 7644 §3.12
  3. Every error → verify schemas includes Error URN
  4. Every error on endpoint route → verify diagnostics extension with requestId, endpointId, logsUrl
     - ScimExceptionFilter now auto-enriches ALL HttpExceptions with diagnostics from correlation context
     - 4 new unit tests in `scim-exception.filter.spec.ts`
  5. Verify logsUrl points to /scim/endpoints/:id/logs/recent (not /admin)
  6. Non-HttpException error → verify GlobalExceptionFilter catches + SCIM 500 body
  ✅ All 6 verified (G.4 fixed: filter now enriches all SCIM-route errors with diagnostics)

### H. Infrastructure (`prisma.service.ts`, `logging.service.ts`, `endpoint.service.ts`, `endpoint-scim-generic.service.ts`)
  1. DB connection failure → verify ScimLogger ERROR (not NestJS Logger)
     - Fixed: wrapped `$connect()` in try-catch with `scimLogger.error(DATABASE, ...)`
  2. Log flush failure → verify ScimLogger ERROR
  3. Endpoint cache warm failure → verify ScimLogger WARN
  4. Schema registry init failure → N/A (no dedicated SchemaRegistry onModuleInit; profiles expand inline)
  5. Corrupt rawPayload on GET → verify ScimLogger WARN with scimId
  6. Corrupt meta on response → verify ScimLogger WARN with scimId
  ✅ All 6 verified (H.1 fixed, H.4 N/A, dead NestJS Logger imports removed from admin.controller.ts and endpoint-scim-generic.controller.ts)

### I. Deployment Modes
  1. InMemory backend: repo.update() on missing record → verify RepositoryError NOT_FOUND + 404
  2. InMemory backend: repo.delete() on missing record → verify RepositoryError NOT_FOUND
  3. Prisma backend: P2025 → verify RepositoryError NOT_FOUND
  4. Prisma backend: P2002 → verify RepositoryError CONFLICT + 409
  5. Prisma backend: connection timeout → verify RepositoryError CONNECTION + 503
### J. Interceptor Log Levels (`request-logging.interceptor.ts`)
  1. 5xx error in catchError -> verify logged at ERROR level
  2. 401/403 error in catchError -> verify logged at WARN level
  3. 404 error in catchError -> verify logged at DEBUG level
  4. Other 4xx error in catchError -> verify logged at INFO level
  5. Slow request (durationMs > threshold) -> verify WARN slow-request log
  6. slowRequestThresholdMs runtime-configurable via PUT /admin/log-config

### K. Diagnostics Enrichment (`scim-errors.ts`)
  1. All 50 createScimError calls have diagnostics -> verify no bare calls
  2. 409 uniqueness -> verify conflictingResourceId, conflictingAttribute, incomingValue, errorCode
  3. PATCH 400 -> verify failedOperationIndex, failedPath, failedOp (via PatchError context)
  4. Filter 400 -> verify parseError field with original parser error message
  5. 428 precondition -> verify currentETag in diagnostics
  6. operation field -> verify auto-read from correlation context when not explicit
  7. errorCode -> verify present on ALL error paths (UNIQUENESS_USERNAME, VALIDATION_SCHEMA, etc.)
  8. GlobalExceptionFilter 500 -> verify diagnostics with requestId/logsUrl

### L. File Logging (`rotating-file-writer.ts`, `file-log-transport.ts`)
  1. LOG_FILE default -> verify logs/scimserver.log created
  2. LOG_FILE="" -> verify no main file created
  3. logFileEnabled=True on endpoint -> verify logs/endpoints/<name>_ep-<id8>/<name>_ep-<id8>.log
  4. logFileEnabled=False (default) -> verify no endpoint file
  5. File rotation -> verify at LOG_FILE_MAX_SIZE (10MB default)
  6. Max rotated files -> verify at LOG_FILE_MAX_COUNT (3 default)
  7. Name sanitization -> verify [^a-zA-Z0-9_-] replaced, truncated to 50 chars
  8. disableEndpointFile -> verify file handle closed, no more writes

### M. Operational (`log-config.controller.ts`, `logging.service.ts`, `admin.controller.ts`)
  1. Ring buffer default 2000 -> verify via getRecentLogs capacity
  2. Config change audit -> verify before/after values: { changes: { globalLevel: { from, to } } }
  3. Empty ring buffer hint -> verify hint field when requestId returns 0 entries
  4. GET /admin/log-config/audit -> verify filters to config/endpoint/auth categories
  5. POST /admin/logs/prune?retentionDays=30 -> verify deletes old entries
  6. GET /admin/logs?minDurationMs=5000 -> verify filters by duration
  7. GET /endpoints/:id/logs/history -> verify queries DB filtered by endpoint URL pattern

### N. Silent Catch Audit
  1. logging.service.ts -> verify 7 catches have TRACE/DEBUG (identifier backfill, deriveIdentifier, resolveUserDisplayName x2, normalizeObject, safeParse)
  2. activity-parser.service.ts -> verify 8 catches have TRACE/DEBUG (requestBody/responseBody parse, URLSearchParams, decodeURIComponent, resolveUserName x2, resolveGroupName, parsePatchOperations)
  3. scim-service-helpers.ts parseJson -> standalone pure function, no logger (acceptable)
  4. Verify 0 silent catches in SCIM core (services, controllers, guards, filters)
## Output Format
For each flow, report:
- ✅ PASS: log present at correct level, correct category, SCIM response properly formatted
- ⚠️ PARTIAL: log present but wrong level/category/missing data
- ❌ FAIL: no log, wrong error format, missing diagnostics, silent catch

At the end, produce:
1. A severity-sorted list of all failures
2. Specific code locations that need fixing
3. Updated test cases to add for any uncovered paths

## Self-Improvement Rules
After each audit run:
1. Add any NEW paths discovered during code reading that weren't in this list
2. Remove paths that are confirmed fully covered and will never regress (have tests)
3. Refine the config flag combinations based on which ones actually produce different behavior
4. Add specific file:line references for each checkpoint so future runs are faster
5. Track the pass rate: "X/Y paths verified" — aim for 100%
6. If a path is found to be untested, add the specific test case (unit/E2E/live) to the output
7. Update the "Flows to Audit" section itself with corrections and additions from findings

## Session Memory
After completing the audit, update Session_starter.md with:
- Date of last audit run
- Pass rate (X/Y)
- Any new gaps discovered (assign gap numbers G30+)
- Any paths added to this prompt
