-- Endpoint Logs and Overview requests filter by endpointId and order by
-- createdAt DESC. Without this access path PostgreSQL scans the global
-- RequestLog timeline until it finds enough rows for the requested endpoint.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "RequestLog_endpointId_createdAt_idx"
ON "RequestLog" ("endpointId", "createdAt");
