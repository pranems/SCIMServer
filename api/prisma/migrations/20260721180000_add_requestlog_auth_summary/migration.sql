-- V10 (credential-lifecycle + auth-in-logs): persist the authentication summary
-- directly on the RequestLog row so the logs list shows the auth outcome
-- instantly + durably, instead of a second query against the ephemeral
-- (30-min TTL) in-memory AuthDecisionRecordStore. Nullable; no backfill
-- (historical rows have null auth fields). authCredentialId (V11) is the
-- winning credential / WIF trust id.
ALTER TABLE "RequestLog" ADD COLUMN "authOutcome" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "authMethod" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "authReason" TEXT;
ALTER TABLE "RequestLog" ADD COLUMN "authCredentialId" UUID;
CREATE INDEX "RequestLog_authOutcome_idx" ON "RequestLog"("authOutcome");
