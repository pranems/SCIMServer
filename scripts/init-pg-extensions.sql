-- PostgreSQL Extension Initialization (Phase 3)
-- Runs automatically on first container start via docker-entrypoint-initdb.d
CREATE EXTENSION IF NOT EXISTS citext;     -- Case-insensitive text type for userName/displayName
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid() for primary keys
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- Trigram indexes for co/sw/ew filter push-down (Phase 4)
