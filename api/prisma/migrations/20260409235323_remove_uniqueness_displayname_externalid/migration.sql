-- DropConstraint (unique constraints must be dropped via ALTER TABLE, not DROP INDEX)
ALTER TABLE "ScimResource" DROP CONSTRAINT IF EXISTS "ScimResource_endpointId_displayName_key";

-- DropConstraint
ALTER TABLE "ScimResource" DROP CONSTRAINT IF EXISTS "ScimResource_endpointId_resourceType_externalId_key";

-- CreateIndex (non-unique, for query performance)
CREATE INDEX IF NOT EXISTS "ScimResource_endpointId_displayName_idx" ON "ScimResource"("endpointId", "displayName");

-- CreateIndex (non-unique, for query performance)
CREATE INDEX IF NOT EXISTS "ScimResource_endpointId_resourceType_externalId_idx" ON "ScimResource"("endpointId", "resourceType", "externalId");
