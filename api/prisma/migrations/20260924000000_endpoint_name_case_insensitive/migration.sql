-- Endpoint names are URL identifiers and therefore compare case-insensitively.
-- Keep the original text column and display casing, but reject case-only
-- duplicates at the database boundary so concurrent creates remain safe.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Endpoint"
    GROUP BY lower("name")
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce case-insensitive Endpoint.name uniqueness: case-only duplicates exist';
  END IF;
END $$;

CREATE UNIQUE INDEX "Endpoint_name_lower_key" ON "Endpoint" (lower("name"));