/*
  Warnings:

  - Added the required column `endpointId` to the `ScimGroup` table without a default value. This is not possible if the table is not empty.
  - Added the required column `endpointId` to the `ScimUser` table without a default value. This is not possible if the table is not empty.
  - Made the column `userNameLower` on table `ScimUser` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "config" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_RequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT,
    "method" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" INTEGER,
    "durationMs" INTEGER,
    "requestHeaders" TEXT NOT NULL,
    "requestBody" TEXT,
    "responseHeaders" TEXT,
    "responseBody" TEXT,
    "errorMessage" TEXT,
    "errorStack" TEXT,
    "identifier" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_RequestLog" ("createdAt", "durationMs", "errorMessage", "errorStack", "id", "identifier", "method", "requestBody", "requestHeaders", "responseBody", "responseHeaders", "status", "url") SELECT "createdAt", "durationMs", "errorMessage", "errorStack", "id", "identifier", "method", "requestBody", "requestHeaders", "responseBody", "responseHeaders", "status", "url" FROM "RequestLog";
DROP TABLE "RequestLog";
ALTER TABLE "new_RequestLog" RENAME TO "RequestLog";
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");
CREATE INDEX "RequestLog_method_idx" ON "RequestLog"("method");
CREATE INDEX "RequestLog_status_idx" ON "RequestLog"("status");
CREATE INDEX "RequestLog_endpointId_idx" ON "RequestLog"("endpointId");
CREATE TABLE "new_ScimGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "scimId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "rawPayload" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScimGroup_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScimGroup" ("createdAt", "displayName", "id", "meta", "rawPayload", "scimId", "updatedAt") SELECT "createdAt", "displayName", "id", "meta", "rawPayload", "scimId", "updatedAt" FROM "ScimGroup";
DROP TABLE "ScimGroup";
ALTER TABLE "new_ScimGroup" RENAME TO "ScimGroup";
CREATE INDEX "ScimGroup_endpointId_idx" ON "ScimGroup"("endpointId");
CREATE UNIQUE INDEX "ScimGroup_endpointId_scimId_key" ON "ScimGroup"("endpointId", "scimId");
CREATE TABLE "new_ScimUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "scimId" TEXT NOT NULL,
    "externalId" TEXT,
    "userName" TEXT NOT NULL,
    "userNameLower" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScimUser_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ScimUser" ("active", "createdAt", "externalId", "id", "meta", "rawPayload", "scimId", "updatedAt", "userName", "userNameLower") SELECT "active", "createdAt", "externalId", "id", "meta", "rawPayload", "scimId", "updatedAt", "userName", "userNameLower" FROM "ScimUser";
DROP TABLE "ScimUser";
ALTER TABLE "new_ScimUser" RENAME TO "ScimUser";
CREATE INDEX "ScimUser_endpointId_idx" ON "ScimUser"("endpointId");
CREATE UNIQUE INDEX "ScimUser_endpointId_scimId_key" ON "ScimUser"("endpointId", "scimId");
CREATE UNIQUE INDEX "ScimUser_endpointId_userNameLower_key" ON "ScimUser"("endpointId", "userNameLower");
CREATE UNIQUE INDEX "ScimUser_endpointId_externalId_key" ON "ScimUser"("endpointId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_name_key" ON "Endpoint"("name");

-- CreateIndex
CREATE INDEX "Endpoint_active_idx" ON "Endpoint"("active");

-- CreateIndex
CREATE INDEX "GroupMember_groupId_idx" ON "GroupMember"("groupId");

-- CreateIndex
CREATE INDEX "GroupMember_userId_idx" ON "GroupMember"("userId");
