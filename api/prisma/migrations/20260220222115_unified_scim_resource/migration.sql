-- CreateTable
CREATE TABLE "ScimResource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "endpointId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "scimId" TEXT NOT NULL,
    "externalId" TEXT,
    "userName" TEXT,
    "userNameLower" TEXT,
    "displayName" TEXT,
    "displayNameLower" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "rawPayload" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScimResource_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ResourceMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "groupResourceId" TEXT NOT NULL,
    "memberResourceId" TEXT,
    "value" TEXT NOT NULL,
    "type" TEXT,
    "display" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResourceMember_groupResourceId_fkey" FOREIGN KEY ("groupResourceId") REFERENCES "ScimResource" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ResourceMember_memberResourceId_fkey" FOREIGN KEY ("memberResourceId") REFERENCES "ScimResource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScimResource_endpointId_resourceType_idx" ON "ScimResource"("endpointId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_scimId_key" ON "ScimResource"("endpointId", "scimId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_userNameLower_key" ON "ScimResource"("endpointId", "userNameLower");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_displayNameLower_key" ON "ScimResource"("endpointId", "displayNameLower");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_resourceType_externalId_key" ON "ScimResource"("endpointId", "resourceType", "externalId");

-- CreateIndex
CREATE INDEX "ResourceMember_groupResourceId_idx" ON "ResourceMember"("groupResourceId");

-- CreateIndex
CREATE INDEX "ResourceMember_memberResourceId_idx" ON "ResourceMember"("memberResourceId");
