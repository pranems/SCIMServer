-- Endpoint Logs and Overview requests filter by endpointId and order by
-- createdAt DESC. Without this access path PostgreSQL scans the global
-- RequestLog timeline until it finds enough rows for the requested endpoint.
-- Keep this unconditional: IF NOT EXISTS would silently accept an invalid
-- index left behind by an interrupted concurrent build.
CREATE INDEX CONCURRENTLY "RequestLog_endpointId_createdAt_idx"
ON "RequestLog" ("endpointId", "createdAt");
