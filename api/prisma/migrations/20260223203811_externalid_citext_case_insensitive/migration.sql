-- AlterTable: Change externalId from VARCHAR(255) to CITEXT for case-insensitive filtering
-- This is required by SCIM RFC 7644 §3.4.2.2 which mandates case-insensitive string comparisons

-- Drop the existing unique constraint/index that depends on externalId
DROP INDEX IF EXISTS "ScimResource_endpointId_resourceType_externalId_key";
ALTER TABLE "ScimResource" DROP CONSTRAINT IF EXISTS "ScimResource_endpointId_resourceType_externalId_key";

-- Alter the column type from VARCHAR(255) to CITEXT (preserves existing data)
ALTER TABLE "ScimResource" ALTER COLUMN "externalId" TYPE citext USING "externalId"::citext;

-- Re-create the unique constraint
ALTER TABLE "ScimResource" ADD CONSTRAINT "ScimResource_endpointId_resourceType_externalId_key" UNIQUE ("endpointId", "resourceType", "externalId");
