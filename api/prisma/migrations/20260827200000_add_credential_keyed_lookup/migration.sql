-- P1: keyed credential lookup.
--
-- A per-endpoint token used to carry nothing identifying, so verification had to
-- bcrypt-compare it against EVERY active credential on the endpoint (measured
-- 287 ms per compare - 5 credentials cost 1.4 s, 25 cost 7.2 s) on a path
-- reachable by an UNAUTHENTICATED caller. The token now carries a public
-- lookupKey so the server reads ONE indexed row and does ONE HMAC comparison.
--
-- Strictly additive. All three columns are nullable or defaulted, so existing
-- rows remain valid and keep verifying via bcrypt until they are rotated.
-- hashAlgo defaults to 'bcrypt', which is exactly what every existing row is.

ALTER TABLE "EndpointCredential" ADD COLUMN "lookupKey" VARCHAR(64);
ALTER TABLE "EndpointCredential" ADD COLUMN "secretHash" VARCHAR(128);
ALTER TABLE "EndpointCredential" ADD COLUMN "hashAlgo" VARCHAR(32) NOT NULL DEFAULT 'bcrypt';

-- UNIQUE is what guarantees the lookup can never fan out. Postgres allows many
-- NULLs under a unique index, so pre-P1 rows are unaffected.
CREATE UNIQUE INDEX "EndpointCredential_lookupKey_key" ON "EndpointCredential"("lookupKey");
