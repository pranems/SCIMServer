-- The activity summary relies on an index-only scan over RequestLog. The
-- default autovacuum thresholds allow enough inserts and deletes to clear the
-- visibility map across many heap pages, turning that scan into random heap
-- reads until the next vacuum. Keep maintenance proportional to this
-- high-churn audit table instead of the PostgreSQL cluster defaults.
ALTER TABLE "RequestLog" SET (
  autovacuum_vacuum_threshold = 1000,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_vacuum_insert_threshold = 1000,
  autovacuum_vacuum_insert_scale_factor = 0.01,
  autovacuum_analyze_threshold = 1000,
  autovacuum_analyze_scale_factor = 0.01
);
