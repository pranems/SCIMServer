# SCIM v2 � Complete Example Resource Payloads and Requests

This document provides runnable examples for SCIM v2 resources and operations. Examples populate all common SCIM attributes (core schema + common extensions such as the Enterprise User extension) with realistic sample values. Some attributes shown may not be implemented in this codebase � they are included for completeness and to help with interoperability testing against SCIM-compliant clients and IdPs.

Warning: these examples include sample values for demonstration only. Do not use real secrets or production credentials.

Base environment used in curl examples
- API_BASE: `http://localhost:3000`
- Example OAuth client: `scimtool-client` / secret `dev-secret-abc123` (development only)
- Shared secret: `S3cr3tSharedValue` (development only)
- Replace `<USER_ID>` and `<GROUP_ID>` where indicated by responses from the server.

---

1) Full User resource example (core + enterprise extension)

This JSON illustrates a complete SCIM User resource with commonly used attributes. The top-level `schemas` array declares the SCIM core user schema and the enterprise extension.

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "id": "a1b2c3d4-e5f6-7890-abcd-1234567890ab",
  "externalId": "ext-000123",
  "userName": "alice.example@example.com",
  "name": {
    "formatted": "Alice L Example",
    "familyName": "Example",
    "givenName": "Alice",
    "middleName": "L",
    "honorificPrefix": "Ms.",
    "honorificSuffix": "PhD"
  },
  "displayName": "Alice Example",
  "nickName": "Ally",
  "profileUrl": "https://profiles.example.com/alice",
  "title": "Senior Engineer",
  "userType": "Employee",
  "preferredLanguage": "en-US",
  "locale": "en_US",
  "timezone": "America/Los_Angeles",
  "active": true,
  "password": "REDACTED_FOR_SECURITY",
  "emails": [
    { "value": "alice.work@example.com", "type": "work", "primary": true },
    { "value": "alice.home@example.net", "type": "home" }
  ],
  "phoneNumbers": [
    { "value": "+1-425-555-0101", "type": "work" },
    { "value": "+1-425-555-0199", "type": "mobile", "primary": false }
  ],
  "ims": [
    { "value": "alice_skype", "type": "skype" }
  ],
  "photos": [
    { "value": "https://cdn.example.com/photos/alice.jpg", "type": "photo" }
  ],
  "addresses": [
    {
      "streetAddress": "1 Microsoft Way",
      "locality": "Redmond",
      "region": "WA",
      "postalCode": "98052",
      "country": "USA",
      "type": "work",
      "formatted": "1 Microsoft Way\nRedmond, WA 98052"
    }
  ],
  "entitlements": ["enterprise-admin"],
  "roles": ["engineering:senior"],
  "x509Certificates": [],
  "groups": [
    { "value": "g-1111111111111", "display": "Engineering" }
  ],

  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "employeeNumber": "EMP-000123",
    "costCenter": "CC-1000",
    "organization": "ExampleCorp",
    "division": "Platform",
    "department": "Engineering",
    "manager": { "value": "mngr-0001", "displayName": "Bob Manager" }
  },

  "meta": {
    "resourceType": "User",
    "created": "2025-01-10T15:23:45Z",
    "lastModified": "2025-01-12T09:17:30Z",
    "location": "http://localhost:3000/scim/v2/Users/a1b2c3d4-e5f6-7890-abcd-1234567890ab"
  }
}
```

Notes:
- Real systems should never return cleartext passwords. The `password` attribute here is shown only to illustrate the attribute and must be handled securely if used.
- `meta.location` should point to the canonical resource URL.

Example: create this user via POST /Users

```sh
curl -i -X POST "http://localhost:3000/scim/v2/Users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d @- <<'JSON'
{ ...copy the JSON above... }
JSON
```

The server should respond with HTTP 201 Created and the created user resource (including server-assigned `id` and `meta`).

---

2) Full Group resource example (core)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "id": "g-1111111111111",
  "displayName": "Engineering",
  "externalId": "group-ext-001",
  "members": [
    { "value": "a1b2c3d4-e5f6-7890-abcd-1234567890ab", "display": "Alice Example", "type": "User" },
    { "value": "u-22222222-3333-4444-5555-666666666666", "display": "Carol Contributor", "type": "User" }
  ],
  "meta": {
    "resourceType": "Group",
    "created": "2025-01-10T15:50:00Z",
    "lastModified": "2025-01-11T10:00:00Z",
    "location": "http://localhost:3000/scim/v2/Groups/g-1111111111111"
  }
}
```

Create group via POST /Groups:

```sh
curl -i -X POST "http://localhost:3000/scim/v2/Groups" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d @- <<'JSON'
{ ...copy the JSON above... }
JSON
```

---

3) ServiceProviderConfig example (capabilities)

This resource describes the SCIM service provider features like patch support, bulk support, authentication schemes, etc. Provide a representative example useful for clients.

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "patch": { "supported": true },
  "bulk": { "supported": false },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": false },
  "sort": { "supported": false },
  "authenticationSchemes": [
    {
      "type": "oauthbearertoken",
      "name": "OAuth Bearer Token",
      "description": "Authorization using the OAuth 2.0 Bearer Token Standard",
      "specUri": "https://tools.ietf.org/html/rfc6750",
      "documentationUri": "https://example.com/docs/auth"
    }
  ]
}
```

Request:

```
curl -H "Authorization: Bearer ${TOKEN}" "http://localhost:3000/scim/v2/ServiceProviderConfig"
```

---

4) SCIM Patch examples

Replace attribute (single op):

Request body for PATCH to change displayName

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "replace", "path": "displayName", "value": "Alice Renamed" }
  ]
}
```

Add member to a group (example PATCH to Group resource):

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    {
      "op": "add",
      "path": "members",
      "value": [ { "value": "new-user-id-9999", "display": "New Member" } ]
    }
  ]
}
```

Remove attribute (delete phoneNumbers entry by value):

```json
{
  "schemas": ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
  "Operations": [
    { "op": "remove", "path": "phoneNumbers[value eq \"+1-425-555-0101\"]" }
  ]
}
```

PATCH request example (replace displayName):

```sh
curl -i -X PATCH "http://localhost:3000/scim/v2/Users/a1b2c3d4-e5f6-7890-abcd-1234567890ab" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d '{"schemas":["urn:ietf:params:scim:api:messages:2.0:PatchOp"],"Operations":[{"op":"replace","path":"displayName","value":"Alice Renamed"}]}'
```

---

5) Example flows: token issuance + protected calls

Obtain OAuth token (client_credentials) � example using the repo's OAuth endpoint

```sh
curl -s -X POST "http://localhost:3000/oauth/token" \
  -H "Content-Type: application/json" \
  -d '{"grant_type":"client_credentials","client_id":"scimtool-client","client_secret":"dev-secret-abc123","scope":"scim.manage scim.read scim.write"}' | jq .
```

Inspect `access_token` from response and use it as `${TOKEN}` in subsequent calls. If you prefer the shared secret fallback, use the header `Authorization: Bearer S3cr3tSharedValue`.

Example: create fully-populated user using curl and inline JSON file (here-document)

```sh
TOKEN="<paste access_token here>"
API_BASE="http://localhost:3000"

curl -i -X POST "${API_BASE}/scim/v2/Users" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/scim+json" \
  -d @- <<'JSON'
{...copy the full User JSON from section 1 above...}
JSON
```

---

6) Notes on attributes not shown but commonly used
- `urn:ietf:params:scim:schemas:core:2.0:User` supports many attributes; implementers may include extra custom extension schemas (URNs).
- `groups` attribute on User is often computed by the server rather than stored as part of the user resource.
- Enterprise extension shown above uses URN `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`.

---

7) Appendix: quick reference curl operations

- Create user (OAuth):
```
curl -X POST "http://localhost:3000/scim/v2/Users" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/scim+json" -d @user.json
```

- Get user:
```
curl -H "Authorization: Bearer ${TOKEN}" "http://localhost:3000/scim/v2/Users/<USER_ID>"
```

- List users with filter:
```
curl -G -H "Authorization: Bearer ${TOKEN}" --data-urlencode "filter=userName eq \"alice.example@example.com\"" "http://localhost:3000/scim/v2/Users"
```

- Create group:
```
curl -X POST "http://localhost:3000/scim/v2/Groups" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/scim+json" -d @group.json
```

- Patch group to add a member:
```
curl -X PATCH "http://localhost:3000/scim/v2/Groups/g-1111111111111" -H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/scim+json" -d @patch-add-member.json
```

---

If you want, I can:
- Generate downloadable example files under `docs/examples/` (user.json, group.json, patch-add-member.json), or
- Produce an OpenAPI v3 spec that includes example payloads for these resources so tools can import them.

Which next?  
