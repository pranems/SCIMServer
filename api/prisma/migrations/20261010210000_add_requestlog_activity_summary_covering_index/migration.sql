-- The Activity summary reads five narrow columns across the last 30 days.
-- Keeping those columns in one index avoids scanning the wide request and
-- response body columns. CONCURRENTLY preserves RequestLog inserts while the
-- prior Container Apps revision continues serving traffic.
CREATE INDEX CONCURRENTLY "RequestLog_activity_summary_idx"
ON "RequestLog" ("createdAt", "method", "url", "identifier", "status");
