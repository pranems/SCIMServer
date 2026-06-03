-- CreateTable
CREATE TABLE "EndpointResourceType" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "schemaUri" VARCHAR(512) NOT NULL,
    "endpoint" VARCHAR(255) NOT NULL,
    "schemaExtensions" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EndpointResourceType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndpointResourceType_endpointId_idx" ON "EndpointResourceType"("endpointId");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointResourceType_endpointId_name_key" ON "EndpointResourceType"("endpointId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointResourceType_endpointId_endpoint_key" ON "EndpointResourceType"("endpointId", "endpoint");

-- AddForeignKey
ALTER TABLE "EndpointResourceType" ADD CONSTRAINT "EndpointResourceType_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
