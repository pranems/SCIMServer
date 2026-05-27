SELECT 'Endpoint' AS tbl, COUNT(*) AS cnt FROM "Endpoint"
UNION ALL SELECT 'ScimResource(all)', COUNT(*) FROM "ScimResource"
UNION ALL SELECT 'ScimResource(User)', COUNT(*) FROM "ScimResource" WHERE "resourceType"='User'
UNION ALL SELECT 'ScimResource(Group)', COUNT(*) FROM "ScimResource" WHERE "resourceType"='Group'
UNION ALL SELECT 'ResourceMember', COUNT(*) FROM "ResourceMember"
UNION ALL SELECT 'ResourceMember(linked)', COUNT(*) FROM "ResourceMember" WHERE "memberResourceId" IS NOT NULL
UNION ALL SELECT 'ResourceMember(unlinked)', COUNT(*) FROM "ResourceMember" WHERE "memberResourceId" IS NULL;
