BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE "public"."Endpoint"
ADD COLUMN "snapshotRevision" UUID NOT NULL DEFAULT gen_random_uuid();

CREATE FUNCTION "public"."scim_endpoint_snapshot_revision"()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
    NEW."snapshotRevision" := pg_catalog.gen_random_uuid();
    RETURN NEW;
END;
$$;

CREATE TRIGGER "Endpoint_snapshot_revision"
BEFORE INSERT OR UPDATE ON "public"."Endpoint"
FOR EACH ROW EXECUTE FUNCTION "public"."scim_endpoint_snapshot_revision"();

ALTER TABLE "public"."Endpoint" ENABLE ALWAYS TRIGGER "Endpoint_snapshot_revision";
COMMIT;
