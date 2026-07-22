-- W1: persist the full AuthDecisionTrace (redacted JSON) on the request log so
-- the log detail renders the expected-vs-received diff permanently, not from the
-- short-TTL AuthDecisionRecordStore.
ALTER TABLE "RequestLog" ADD COLUMN "authDecision" TEXT;
