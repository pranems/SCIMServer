-- CreateTable
CREATE TABLE "EndpointSchema" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" UUID NOT NULL,
    "schemaUrn" VARCHAR(512) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "resourceTypeId" VARCHAR(50),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "attributes" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "EndpointSchema_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndpointSchema_endpointId_idx" ON "EndpointSchema"("endpointId");

-- CreateIndex
CREATE UNIQUE INDEX "EndpointSchema_endpointId_schemaUrn_key" ON "EndpointSchema"("endpointId", "schemaUrn");

-- AddForeignKey
ALTER TABLE "EndpointSchema" ADD CONSTRAINT "EndpointSchema_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
