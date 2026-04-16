/*
  Warnings:

  - You are about to drop the column `deletedAt` on the `ScimResource` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "ScimResource_endpointId_displayName_key";

-- AlterTable
ALTER TABLE "ScimResource" DROP COLUMN "deletedAt";

-- CreateIndex
CREATE INDEX "RequestLog_identifier_idx" ON "RequestLog"("identifier");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_method_url_idx" ON "RequestLog"("createdAt", "method", "url");
