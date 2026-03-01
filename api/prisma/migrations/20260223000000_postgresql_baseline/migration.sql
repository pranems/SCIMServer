-- Phase 3: PostgreSQL baseline migration
-- Replaces all previous SQLite migrations with PostgreSQL-native types:
--   CITEXT   — case-insensitive userName/displayName (no more *Lower columns)
--   JSONB    — payload storage (replaces rawPayload TEXT)
--   UUID     — all primary keys via gen_random_uuid() (pgcrypto)
--   TIMESTAMPTZ — timezone-aware timestamps
--   pg_trgm  — trigram index support for future SCIM filter push-down

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "displayName" TEXT,
    "description" TEXT,
    "config" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLog" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" UUID,
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
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScimResource" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" UUID NOT NULL,
    "resourceType" VARCHAR(50) NOT NULL,
    "scimId" UUID NOT NULL,
    "externalId" VARCHAR(255),
    "userName" CITEXT,
    "displayName" CITEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "meta" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "ScimResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResourceMember" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "groupResourceId" UUID NOT NULL,
    "memberResourceId" UUID,
    "value" TEXT NOT NULL,
    "type" TEXT,
    "display" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_name_key" ON "Endpoint"("name");

-- CreateIndex
CREATE INDEX "Endpoint_active_idx" ON "Endpoint"("active");

-- CreateIndex
CREATE INDEX "RequestLog_createdAt_idx" ON "RequestLog"("createdAt");

-- CreateIndex
CREATE INDEX "RequestLog_method_idx" ON "RequestLog"("method");

-- CreateIndex
CREATE INDEX "RequestLog_status_idx" ON "RequestLog"("status");

-- CreateIndex
CREATE INDEX "RequestLog_endpointId_idx" ON "RequestLog"("endpointId");

-- CreateIndex
CREATE INDEX "ScimResource_endpointId_resourceType_idx" ON "ScimResource"("endpointId", "resourceType");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_scimId_key" ON "ScimResource"("endpointId", "scimId");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_userName_key" ON "ScimResource"("endpointId", "userName");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_displayName_key" ON "ScimResource"("endpointId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "ScimResource_endpointId_resourceType_externalId_key" ON "ScimResource"("endpointId", "resourceType", "externalId");

-- CreateIndex
CREATE INDEX "ResourceMember_groupResourceId_idx" ON "ResourceMember"("groupResourceId");

-- CreateIndex
CREATE INDEX "ResourceMember_memberResourceId_idx" ON "ResourceMember"("memberResourceId");

-- AddForeignKey
ALTER TABLE "RequestLog" ADD CONSTRAINT "RequestLog_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScimResource" ADD CONSTRAINT "ScimResource_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceMember" ADD CONSTRAINT "ResourceMember_groupResourceId_fkey" FOREIGN KEY ("groupResourceId") REFERENCES "ScimResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceMember" ADD CONSTRAINT "ResourceMember_memberResourceId_fkey" FOREIGN KEY ("memberResourceId") REFERENCES "ScimResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
