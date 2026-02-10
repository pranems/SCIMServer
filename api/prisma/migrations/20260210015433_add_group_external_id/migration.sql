/*
  Warnings:

  - A unique constraint covering the columns `[endpointId,externalId]` on the table `ScimGroup` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ScimGroup" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ScimGroup_endpointId_externalId_key" ON "ScimGroup"("endpointId", "externalId");
