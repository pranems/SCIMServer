-- AlterTable: Add userNameLower column for case-insensitive userName matching
-- RFC 7643 §2.1: "Attribute names are case insensitive"
-- RFC 7643 §3.1: userName caseExact=false — uniqueness must be case-insensitive

-- Step 1: Add column (nullable initially for backfill)
ALTER TABLE "ScimUser" ADD COLUMN "userNameLower" TEXT;

-- Step 2: Backfill from existing userName (SQLite lower() function)
UPDATE "ScimUser" SET "userNameLower" = lower("userName");

-- Step 3: Make column NOT NULL now that all rows have a value
-- SQLite doesn't support ALTER COLUMN, so we use a pragma trick:
-- Prisma handles this via its migration engine, but for raw SQL:
-- We rely on the NOT NULL being enforced by the application layer
-- and the Prisma schema definition going forward.

-- Step 4: Drop old unique index on (endpointId, userName)
DROP INDEX IF EXISTS "ScimUser_endpointId_userName_key";

-- Step 5: Create new unique index on (endpointId, userNameLower)
CREATE UNIQUE INDEX "ScimUser_endpointId_userNameLower_key" ON "ScimUser"("endpointId", "userNameLower");
