# Endpoint Lifecycle & Usage Guide

> **Version:** 0.38.0 - **Updated:** April 24, 2026  
> Quick-start recipes for common SCIMServer operations

---

## Table of Contents

- [Endpoint Lifecycle](#endpoint-lifecycle)
- [User Provisioning Recipes](#user-provisioning-recipes)
- [Group Management Recipes](#group-management-recipes)
- [PATCH Operations Cookbook](#patch-operations-cookbook)
- [Filtering & Search Recipes](#filtering--search-recipes)
- [Credential Management](#credential-management)
- [Monitoring & Debugging](#monitoring--debugging)
- [Entra ID Integration](#entra-id-integration)

---

## Endpoint Lifecycle

### 1. Create

```bash
# From preset
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"name":"prod","profilePreset":"entra-id"}'
```

### 2. Configure

```bash
# Update settings
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"profile":{"settings":{"RequireIfMatch":true,"PerEndpointCredentialsEnabled":true}}}'
```

### 3. Use

```bash
# SCIM operations
curl -X POST http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"user@example.com"}'
```

### 4. Monitor

```bash
# Stats
curl http://localhost:8080/scim/admin/endpoints/{id}/stats \
  -H "Authorization: Bearer changeme-scim"

# Live logs
curl -N http://localhost:8080/scim/endpoints/{id}/logs/stream \
  -H "Authorization: Bearer changeme-scim"
```

### 5. Deactivate

```bash
# Blocks all SCIM operations (returns 403), preserves data
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"active":false}'
```

### 6. Reactivate

```bash
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"active":true}'
```

### 7. Delete

```bash
# Cascades all resources, logs, credentials
curl -X DELETE http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim"
```

---

## User Provisioning Recipes

### Create Basic User

```bash
curl -X POST http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
    "userName":"jane@example.com",
    "displayName":"Jane Doe",
    "active":true
  }'
```

### Create User with Enterprise Extension

```bash
curl -X POST http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":[
      "urn:ietf:params:scim:schemas:core:2.0:User",
      "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
    ],
    "userName":"jane@example.com",
    "name":{"givenName":"Jane","familyName":"Doe"},
    "displayName":"Jane Doe",
    "emails":[{"value":"jane@example.com","type":"work","primary":true}],
    "active":true,
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User":{
      "department":"Engineering",
      "costCenter":"CC-1234",
      "manager":{"value":"mgr-id","displayName":"Bob Manager"}
    }
  }'
```

### Find User by userName

```bash
curl "http://localhost:8080/scim/endpoints/{id}/Users?filter=userName%20eq%20%22jane%40example.com%22" \
  -H "Authorization: Bearer changeme-scim"
```

### Deactivate User (Soft Delete)

```bash
curl -X PATCH http://localhost:8080/scim/endpoints/{id}/Users/{uid} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations":[{"op":"replace","path":"active","value":false}]
  }'
```

### Hard Delete User

```bash
curl -X DELETE http://localhost:8080/scim/endpoints/{id}/Users/{uid} \
  -H "Authorization: Bearer changeme-scim"
```

---

## Group Management Recipes

### Create Group with Members

```bash
curl -X POST http://localhost:8080/scim/endpoints/{id}/Groups \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName":"Engineering",
    "members":[{"value":"user-id-1"},{"value":"user-id-2"}]
  }'
```

### Add Members to Group

```bash
curl -X PATCH http://localhost:8080/scim/endpoints/{id}/Groups/{gid} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations":[{
      "op":"add","path":"members",
      "value":[{"value":"new-user-id-1"},{"value":"new-user-id-2"}]
    }]
  }'
```

### Remove Member from Group

```bash
curl -X PATCH http://localhost:8080/scim/endpoints/{id}/Groups/{gid} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    "Operations":[{
      "op":"remove","path":"members[value eq \"user-id-to-remove\"]"
    }]
  }'
```

---

## PATCH Operations Cookbook

### Replace Simple Attribute

```json
{"op":"replace","path":"displayName","value":"New Name"}
```

### Replace Nested Attribute (dot-notation)

Requires `VerbosePatchSupported: true`:

```json
{"op":"replace","path":"name.givenName","value":"Jane"}
```

### Add Multi-Valued Entry

```json
{"op":"add","path":"emails","value":[{"value":"work@example.com","type":"work","primary":true}]}
```

### Replace via ValuePath Filter

```json
{"op":"replace","path":"emails[type eq \"work\"].value","value":"new-work@example.com"}
```

### Remove via ValuePath Filter

```json
{"op":"remove","path":"phoneNumbers[type eq \"fax\"]"}
```

### Update Extension Attribute

```json
{"op":"replace","path":"urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department","value":"Product"}
```

### No-Path Replace (Full Resource Merge)

```json
{"op":"replace","value":{"displayName":"New Name","active":false}}
```

---

## Filtering & Search Recipes

### Common Filters

```bash
# Exact match
?filter=userName eq "jane@example.com"

# Starts with
?filter=userName sw "jane"

# Contains
?filter=displayName co "Smith"

# Active users
?filter=active eq true

# Combined (AND)
?filter=active eq true and userName sw "j"

# Combined (OR)
?filter=displayName co "Smith" or displayName co "Jones"

# External ID present
?filter=externalId pr

# Created after date
?filter=meta.created gt "2026-01-01T00:00:00Z"
```

### POST .search (Long Filters)

```bash
curl -X POST http://localhost:8080/scim/endpoints/{id}/Users/.search \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
    "filter":"userName sw \"a\" or userName sw \"b\" or userName sw \"c\"",
    "startIndex":1,"count":50,
    "sortBy":"userName","sortOrder":"ascending",
    "attributes":["userName","displayName","emails"]
  }'
```

---

## Credential Management

### Enable Per-Endpoint Credentials

```bash
curl -X PATCH http://localhost:8080/scim/admin/endpoints/{id} \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"profile":{"settings":{"PerEndpointCredentialsEnabled":true}}}'
```

### Create Credential

```bash
curl -X POST http://localhost:8080/scim/admin/endpoints/{id}/credentials \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"label":"entra-connector","credentialType":"bearer"}'
# Save the returned token - it is shown only once!
```

### Use Scoped Token

```bash
curl http://localhost:8080/scim/endpoints/{id}/Users \
  -H "Authorization: Bearer scim_ep_..."
```

### Revoke Credential

```bash
curl -X DELETE http://localhost:8080/scim/admin/endpoints/{id}/credentials/{credId} \
  -H "Authorization: Bearer changeme-scim"
```

---

## Monitoring & Debugging

### Live Log Stream

```bash
# All endpoints
curl -N http://localhost:8080/scim/admin/log-config/stream \
  -H "Authorization: Bearer changeme-scim"

# Specific endpoint
curl -N http://localhost:8080/scim/endpoints/{id}/logs/stream \
  -H "Authorization: Bearer changeme-scim"
```

### Increase Log Verbosity

```bash
# Global
curl -X PUT http://localhost:8080/scim/admin/log-config/level/DEBUG \
  -H "Authorization: Bearer changeme-scim"

# Per-endpoint
curl -X PUT http://localhost:8080/scim/admin/log-config/endpoint/{id}/TRACE \
  -H "Authorization: Bearer changeme-scim"
```

### Query Recent Errors

```bash
curl "http://localhost:8080/scim/admin/log-config/recent?level=ERROR&limit=20" \
  -H "Authorization: Bearer changeme-scim"
```

### Download Logs

```bash
curl http://localhost:8080/scim/admin/log-config/download?format=ndjson \
  -H "Authorization: Bearer changeme-scim" -o logs.ndjson
```

### Check Endpoint Stats

```bash
curl http://localhost:8080/scim/admin/endpoints/{id}/stats \
  -H "Authorization: Bearer changeme-scim"
# {"users":150,"groups":12,"groupMembers":340,"requestLogs":4200}
```

---

## Entra ID Integration

### 1. Create Entra-Compatible Endpoint

```bash
curl -X POST http://localhost:8080/scim/admin/endpoints \
  -H "Authorization: Bearer changeme-scim" \
  -H "Content-Type: application/json" \
  -d '{"name":"entra-prod","profilePreset":"entra-id"}'
```

### 2. Note the SCIM URL

The response includes `scimBasePath`. Your Entra ID tenant URL is:

```
http://localhost:8080/scim/endpoints/{endpointId}/
```

### 3. Configure Entra ID

In Azure Portal > Enterprise Application > Provisioning:
- **Tenant URL:** `https://your-domain/scim/endpoints/{endpointId}/`
- **Secret Token:** Your `SCIM_SHARED_SECRET` value

### 4. URL Rewrite for /scim/v2/

Entra ID may send requests to `/scim/v2/*`. SCIMServer auto-rewrites these:

```
/scim/v2/endpoints/{id}/Users  ->  /scim/endpoints/{id}/Users
```

### 5. Test Connection

Entra ID's "Test Connection" will call `GET /scim/endpoints/{id}/Users?filter=userName eq "nonexistent"`. This should return an empty ListResponse (200 OK).

### 6. Monitor Provisioning

```bash
# Watch live
curl -N http://localhost:8080/scim/endpoints/{id}/logs/stream \
  -H "Authorization: Bearer changeme-scim"

# Check audit trail
curl "http://localhost:8080/scim/admin/logs?page=1&pageSize=50" \
  -H "Authorization: Bearer changeme-scim"
```
