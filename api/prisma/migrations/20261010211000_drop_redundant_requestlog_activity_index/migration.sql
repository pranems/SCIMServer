-- The five-column Activity summary index has the same leading columns as this
-- older index, so retaining both would duplicate storage and write overhead.
-- This runs only after the covering-index migration succeeds.
DROP INDEX CONCURRENTLY "RequestLog_createdAt_method_url_idx";
