-- CreateTable
CREATE TABLE "EndpointCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" UUID NOT NULL,
    "credentialType" VARCHAR(50) NOT NULL,
    "credentialHash" VARCHAR(255) NOT NULL,
    "label" VARCHAR(255),
    "metadata" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ,

    CONSTRAINT "EndpointCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EndpointCredential_endpointId_active_idx" ON "EndpointCredential"("endpointId", "active");

-- AddForeignKey
ALTER TABLE "EndpointCredential" ADD CONSTRAINT "EndpointCredential_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "Endpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
