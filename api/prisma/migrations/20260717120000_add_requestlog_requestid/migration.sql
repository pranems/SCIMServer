-- P3 (auth observability): add the X-Request-Id correlation id to RequestLog so
-- an auth-decision trace (AuthDecisionTrace.correlationId) can bridge to its
-- matching request-log row and vice-versa. Nullable + indexed; no backfill
-- (historical rows simply have a null requestId).
ALTER TABLE "RequestLog" ADD COLUMN "requestId" UUID;
CREATE INDEX "RequestLog_requestId_idx" ON "RequestLog"("requestId");
