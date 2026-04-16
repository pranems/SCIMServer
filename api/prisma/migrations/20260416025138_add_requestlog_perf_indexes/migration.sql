-- RequestLog performance indexes for activity summary count() queries.
-- The original Prisma-generated migration bundled schema drift artifacts
-- (DROP INDEX displayName_key + DROP COLUMN deletedAt) that were already
-- handled by prior migrations. Those have been removed to prevent failures
-- on databases that already applied 20260409 and/or the deletedAt removal.

-- Safe cleanup: drop deletedAt column IF it still exists (schema drift from Apr 9)
ALTER TABLE "ScimResource" DROP COLUMN IF EXISTS "deletedAt";

-- Safe cleanup: drop stale unique index IF it still exists (already dropped as constraint in 20260409)
DROP INDEX IF EXISTS "ScimResource_endpointId_displayName_key";

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequestLog_identifier_idx" ON "RequestLog"("identifier");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RequestLog_createdAt_method_url_idx" ON "RequestLog"("createdAt", "method", "url");
