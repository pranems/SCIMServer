# SCIM v2 — Complete API Reference (RFC‑style guide with examples)

This document is a standalone reference for the SCIM v2 REST API (RFC 7643, RFC 7644 and related guidance). It describes standard endpoints, supported query parameters, request and response shapes, common options and filter expressions, and provides fully populated example requests/responses for each operation and combinations of flags/parameters.

Note: this guide is implementation-agnostic and intended for developers building or integrating with SCIM v2 services.

Contents
- Basics (auth, headers, media types)
- Core endpoints
  - `GET /ServiceProviderConfig`
  - `GET /ResourceTypes`
  - `GET /Schemas`
  - `GET /ResourceType/:name` (optional)
  - `POST /Bulk` (optional)
- `Users` resource
  - `POST /Users` — create
  - `GET /Users` — list/filter/paginate/sort
  - `GET /Users/{id}` — retrieve
  - `PUT /Users/{id}` — replace
  - `PATCH /Users/{id}` — patch (add/replace/remove)
  - `DELETE /Users/{id}` — delete
- `Groups` resource (analogous to Users)
- Filtering & Search reference (examples)
- PATCH examples (add/replace/remove)
- Bulk example
- OpenAPI + Insomnia artifacts (how to import)
- Extensibility (detailed steps and examples)

---

Basics
- Base path: example `https://api.example.com/scim/v2` (many servers accept `/scim` or `/scim/v2`).
- Authentication: SCIM does not mandate a single auth method; in practice use `Authorization: Bearer <token>` (OAuth 2.0 bearer tokens) or other transport-level auth.
- Media type: use `Content-Type: application/scim+json` for request bodies and `Accept: application/scim+json` for responses.
- Standard error format (example):

```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:Error"],
  "status":"404",
  "scimType":"",
  "detail":"Not found"
}
```

---

Service endpoints

GET /ServiceProviderConfig
- Purpose: advertise server capabilities (patch, bulk, filter, sort, authenticationSchemes).
- Example request:
  curl -H "Authorization: Bearer ${TOKEN}" "https://api.example.com/scim/v2/ServiceProviderConfig"
- Example response (truncated):

```json
{
  "schemas":["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch":{"supported":true},
  "bulk":{"supported":true,"maxOperations":1000,"maxPayloadSize":10485760},
  "filter":{"supported":true,"maxResults":1000},
  "changePassword":{"supported":false},
  "sort":{"supported":false},
  "authenticationSchemes":[{"type":"oauthbearertoken","name":"OAuth 2.0 Bearer"}]
}
```

Minimal RFC-conformant `ServiceProviderConfig` example
- The SCIM RFCs define the `ServiceProviderConfig` structure and the fields that describe supported capabilities. The file `docs/examples/serviceproviderconfig_rfc_minimal.json` contains a minimal example strictly limited to RFC-defined fields. Use it when you need a canonical, RFC-compliant capability document.

Inline minimal example (RFC fields only):

```json
{
  "schemas": [ "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig" ],
  "patch": { "supported": true },
  "bulk": { "supported": false },
  "filter": { "supported": true, "maxResults": 1000 },
  "changePassword": { "supported": false },
  "sort": { "supported": false },
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "OAuth 2.0 Bearer Token",
      "specUri": "https://tools.ietf.org/html/rfc6750"
    }
  ]
}
```

- File: `docs/examples/serviceproviderconfig_rfc_minimal.json`

GET /ResourceTypes
- Purpose: list resource types (User, Group, possibly others).

GET /Schemas
- Purpose: list schema definitions supported by the server (core User/Group and any extensions).

POST /Bulk (optional)
- Purpose: support bulk operations (create/update/delete multiple resources in one request). Many servers do not implement Bulk.
- Example: see Bulk example section below.

---

Users resource

1) POST /Users — create user
- Mandatory headers: `Authorization`, `Content-Type: application/scim+json`.
- Successful response: 201 Created with Location header pointing to created resource and body containing the created resource including `id` and `meta`.
- Example request (fully populated User):

```sh
curl -i -X POST "https://api.example.com/scim/v2/Users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User","urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
    "userName":"alice@example.com",
    "externalId":"ext-001",
    "name":{"givenName":"Alice","familyName":"Example","formatted":"Alice Example"},
    "displayName":"Alice Example",
    "nickName":"Ally",
    "title":"Senior Engineer",
    "active":true,
    "emails":[{"value":"alice@example.com","type":"work","primary":true}],
    "phoneNumbers":[{"value":"+1-425-555-0101","type":"work"}],
    "addresses":[{"streetAddress":"1 Microsoft Way","locality":"Redmond","region":"WA","postalCode":"98052","country":"USA","type":"work","formatted":"1 Microsoft Way\nRedmond, WA 98052"}],
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {"employeeNumber":"EMP-1000","department":"Engineering","manager":{"value":"manager-1","displayName":"Bob Manager"}}
  }'
```

2) GET /Users — list, filtering and pagination
- Query parameters supported by RFC:
  - `startIndex` (1-based)
  - `count` (page size)
  - `filter` (SCIM filter expression)
  - `sortBy` (attribute)
  - `sortOrder` (`ascending` or `descending`)
  - `attributes` (comma separated list to return)
  - `excludedAttributes` (comma list to exclude)

- Example: list 50 users starting at 1, sorted by familyName:

```
curl -H "Authorization: Bearer ${TOKEN}" "https://api.example.com/scim/v2/Users?startIndex=1&count=50&sortBy=name.familyName&sortOrder=ascending"
```

- Example: filter where userName equals exact value:

```
curl -G -H "Authorization: Bearer ${TOKEN}" --data-urlencode "filter=userName eq \"alice@example.com\"" "https://api.example.com/scim/v2/Users"
```

- Example: complex filter (active users in Engineering):

```
curl -G -H "Authorization: Bearer ${TOKEN}" --data-urlencode "filter=active eq true and urn:ietf:params:scim:schemas:extension:enterprise:2.0:User.department eq \"Engineering\"" "https://api.example.com/scim/v2/Users"
```

- Attributes selection example (only return id, userName, displayName):

```
curl -H "Authorization: Bearer ${TOKEN}" "https://api.example.com/scim/v2/Users?attributes=id,userName,displayName"
```

- Response (list): the server returns a SCIM list response with `totalResults`, `startIndex`, `itemsPerPage`, and `Resources` array.

3) GET /Users/{id} — retrieve single user
- Example:
```
curl -H "Authorization: Bearer ${TOKEN}" "https://api.example.com/scim/v2/Users/a1b2c3d4"
```

4) PUT /Users/{id} — replace
- PUT semantics: full resource replacement. Provide the complete resource body for the `id` and server returns updated resource.
- Example: PUT with a full user payload (same shape as POST).

5) PATCH /Users/{id} — partial updates
- Use SCIM Patch operations. Header `Content-Type: application/scim+json`.
- Common operations: `add`, `replace`, `remove`.

PATCH examples (see PATCH section below for more).

6) DELETE /Users/{id}
- Delete resource. Server returns 204 No Content on success.
- Example:
```
curl -i -X DELETE -H "Authorization: Bearer ${TOKEN}" "https://api.example.com/scim/v2/Users/a1b2c3d4"
```

---

Groups resource
- Analogous to Users. Endpoints: `POST /Groups`, `GET /Groups`, `GET /Groups/{id}`, `PUT /Groups/{id}`, `PATCH /Groups/{id}`, `DELETE /Groups/{id}`.
- Full Group create example (fully populated):

```sh
curl -i -X POST "https://api.example.com/scim/v2/Groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:Group"],
    "displayName":"Engineering",
    "externalId":"group-ext-001",
    "members":[{"value":"a1b2c3d4","display":"Alice Example"},{"value":"u2","display":"Carol"}]
  }'
```

---

Filtering and search reference

SCIM filter language summary (operators and examples):
- Comparison operators: `eq`, `ne`, `co` (contains), `sw` (starts with), `ew` (ends with), `pr` (present) — e.g. `userName co "example"`.
- Logical operators: `and`, `or`, `not`.
- Grouping with parentheses.
- Multi-valued attribute filters use square-bracket style in attribute names in some implementations (server specific) but RFC syntax uses attribute paths.

Examples:
- Exact match: `userName eq "alice@example.com"`
- Case-insensitive contains: `displayName co "ali"`
- Starts with: `name.givenName sw "Al"`
- Present: `emails pr`
- Combined: `active eq true and emails[type eq "work"].value co "@example.com"`

Note: not all servers support complex paths in the same way; test compatibility.

---

PATCH examples (detailed)

1) Replace displayName (simple replace):

Request body:
```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations":[{"op":"replace","path":"displayName","value":"Alice Renamed"}]
}
```

2) Add a work phone number:

```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations":[{"op":"add","path":"phoneNumbers","value":[{"value":"+1-425-555-0133","type":"work"}]}]
}
```

3) Remove a phone number by value (some servers accept complex filter path):

```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations":[{"op":"remove","path":"phoneNumbers[value eq \"+1-425-555-0101\"]"}]
}
```

4) Add member to group (PATCH Group):

```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations":[{"op":"add","path":"members","value":[{"value":"new-user-id","display":"New User"}]}]
}
```

---

Bulk example (optional endpoint)

Bulk request to create two users and delete one group (server must advertise Bulk support):

```json
{
  "schemas":["urn:ietf:params:scim:api:messages:2.0:BulkRequest"],
  "Operations":[
    {"method":"POST","path":"/Users","bulkId":"q1","data":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"u1@example.com","displayName":"User 1"}},
    {"method":"POST","path":"/Users","bulkId":"q2","data":{"schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],"userName":"u2@example.com","displayName":"User 2"}},
    {"method":"DELETE","path":"/Groups/g-12345"}
  ]
}
```

---

Examples — fully populated sample payloads (ready to copy)

User example (full): see `docs/examples/user.json` (included as separate file in this package). This JSON contains core attributes and the enterprise extension with typical values.

Group example (full): see `docs/examples/group.json`.

ServiceProviderConfig example: see `docs/examples/serviceproviderconfig.json`.

PATCH files: `docs/examples/patch-add-member.json`, `docs/examples/patch-replace-displayName.json`.

---

OpenAPI & Insomnia

- An OpenAPI v3 JSON (partial spec with examples) is available at `docs/openapi/SCIM_v2_openapi.json` for import into tools that support OpenAPI.
- An Insomnia export JSON with a collection of requests covering the major endpoints and examples is available at `docs/insomnia/SCIM_v2_Insomnia_Collection.json`.

Import these into your REST client and update the environment variables:
- `base_url` — API base (e.g. `http://localhost:3000`)
- `token` — bearer token for Authorization if required

---

Extensibility

SCIM v2 is designed to be extensible. This section describes how servers can advertize extensions and clients can use them.

1. Server advertises supported extensions in `GET /ServiceProviderConfig` response, e.g.:

```json
{
  "schemas":["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  ...
  "schemasSupported":["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]
}
```

2. Client includes desired extension in `POST` or `PUT` request, e.g.:
```sh
curl -i -X POST "https://api.example.com/scim/v2/Users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User","urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"],
    ...
  }'
```

3. Server processes and retains extension attributes as per its configuration and capabilities.

4. Client can retrieve and query extension attributes using standard SCIM mechanisms (e.g. `GET /Users/{id}` or filtering on `GET /Users`).

---

Notes & compatibility
- SCIM servers vary in support: Bulk, PATCH, Filter, Sort, and attributes selection may be optional. Always consult the server's `ServiceProviderConfig`.
- Attribute names and extension URNs must match between client and server.

---

*** Provider deliverables checklist ***

Below is a recommended deliverables checklist a SCIM service provider should supply to integrators. The repository contains example artifacts you can reuse or adapt.

Machine-readable runtime discovery (required)
- `GET /ServiceProviderConfig` — live JSON endpoint (SCIM standard). Example template: `docs/examples/serviceproviderconfig_template.jsonc`.
- `GET /Schemas` — full schema documents for core and extension URNs. Example schema files: `docs/examples/schema_custom_extension.json`.
- `GET /ResourceTypes` — list of resource types supported.

Tooling & importable artifacts (strongly recommended)
- OpenAPI v3 specification (examples + schemas): `docs/openapi/SCIM_v2_openapi_full.json` and `docs/openapi/SCIM_v2_openapi.json`.
- Postman collection for quick testing/import: `docs/postman/SCIM_v2_Postman_Collection.json`.
- Insomnia workspace export: `docs/insomnia/SCIMTool_Insomnia_Full_Export.json` and `docs/insomnia/SCIMTool_Insomnia_Export.json`.
- Example resource JSON files (fully populated):
  - `docs/examples/user.json`
  - `docs/examples/group.json`
  - `docs/examples/user_with_custom_extension.json`
  - `docs/examples/serviceproviderconfig.json`
  - `docs/examples/serviceproviderconfig_template.jsonc`

Operational & integration notes (include in provider docs)
- Authentication guide (how to obtain tokens, required scopes, shared-secret usage). Add to `documentationUri` referred in ServiceProviderConfig.
- Paging, filtering and sort semantics, including maximums and supported operators (also present in ServiceProviderConfig fields `filter.maxResults`).
- Uniqueness constraints (which attributes are unique) and conflict behaviors (HTTP 409 + SCIM error `scimType=uniqueness`).
- Rate limit rules and headers (if applicable). Example fields in the template: `rateLimiting`.
- ETag and concurrency model (If-Match semantics) if supported — see `etagSupport` in the template.

How to use the artifacts
- Import the OpenAPI JSON into Swagger UI / Redoc / OpenAPI-compatible tools to generate interactive docs and client code.
- Import the Postman collection into Postman (File → Import) and set the `base_url` and `token` variables in the collection environment.
- Import the Insomnia export (File → Import) and update environment variables (`base_url`, `token`). The Insomnia collection references example files in `docs/examples/` — copy them into the workspace or paste as request bodies.

Next steps - nice to have
- Validate the OpenAPI spec with an OpenAPI linter and fix issues.
- Expand the Postman collection to include OAuth token acquisition, PATCH, Bulk and admin endpoints.
- Publish a minimal provider documentation HTML page generated from the OpenAPI spec.