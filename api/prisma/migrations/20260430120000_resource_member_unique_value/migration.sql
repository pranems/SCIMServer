-- Tier-0 #5: prevent duplicate memberships at DB level.
--
-- Step 1: deduplicate any existing duplicate (groupResourceId, value) rows.
-- We keep the row with the smallest createdAt (oldest), with id as tiebreaker
-- for reproducibility. This is safe to re-run because the DELETE clause is
-- bounded by EXISTS-of-older-row.
DELETE FROM "ResourceMember" rm
WHERE EXISTS (
  SELECT 1 FROM "ResourceMember" older
  WHERE older."groupResourceId" = rm."groupResourceId"
    AND older."value" = rm."value"
    AND (
      older."createdAt" < rm."createdAt"
      OR (older."createdAt" = rm."createdAt" AND older.id < rm.id)
    )
);

-- Step 2: apply the unique constraint. Must come after dedupe.
-- SCIM identifies a member by its `value` sub-attribute (always populated).
-- memberResourceId is nullable (external members), so it is NOT a suitable
-- column for the unique constraint.
CREATE UNIQUE INDEX "ResourceMember_groupResourceId_value_key"
  ON "ResourceMember"("groupResourceId", "value");
