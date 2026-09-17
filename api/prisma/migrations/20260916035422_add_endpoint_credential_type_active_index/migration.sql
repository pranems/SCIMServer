-- CreateIndex
CREATE INDEX "EndpointCredential_endpointId_credentialType_active_idx" ON "EndpointCredential"("endpointId", "credentialType", "active");
