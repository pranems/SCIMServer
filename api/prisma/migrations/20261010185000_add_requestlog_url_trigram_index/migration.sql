CREATE INDEX IF NOT EXISTS "RequestLog_url_trgm_idx"
ON "RequestLog"
USING GIN ("url" gin_trgm_ops);
