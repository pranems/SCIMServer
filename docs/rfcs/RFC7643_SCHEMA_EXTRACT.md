# RFC 7643 - Canonical Schema Representations (Normative Extracts)

> **Source**: [RFC 7643 §8.7.1](https://datatracker.ietf.org/doc/html/rfc7643#section-8.7.1) - Resource Schema Representation  
> **Fetched**: 2026-04-16 from https://datatracker.ietf.org/doc/html/rfc7643  
> **Purpose**: Authoritative reference for attribute-level compliance audits  
> **RFC Status**: Standards Track (September 2015), Updated by RFC 9865  
> **Authors**: P. Hunt (Oracle), K. Grizzle (SailPoint), E. Wahlstroem (Nexus), C. Mortimore (Salesforce)

---

## Key RFC Sections Referenced

| Section | Title | Key Content |
|---|---|---|
| §2.2 | Attribute Characteristics | Lists 7 characteristics with defaults |
| §2.3 | Attribute Data Types | string, boolean, decimal, integer, dateTime, binary, reference, complex |
| §2.4 | Multi-Valued Attributes | Default sub-attrs: type, primary, display, value, $ref |
| §3.1 | Common Attributes | id, externalId, meta - NOT part of schema attrs, but part of every resource |
| §4.1 | User Resource Schema | Singular + multi-valued User attributes |
| §4.2 | Group Resource Schema | displayName + members |
| §4.3 | Enterprise User Schema Extension | employeeNumber, costCenter, organization, division, department, manager |
| §5 | ServiceProviderConfig | patch, bulk, filter, sort, etag, changePassword, authenticationSchemes |
| §6 | ResourceType Schema | id, name, endpoint, schema, schemaExtensions |
| §7 | Schema Definition | Schema of schemas - 11 characteristics |
| §8.7.1 | Resource Schema Representation | **Normative** JSON for User, Group, EnterpriseUser schemas |

---

## §2.2 - Attribute Characteristic Defaults (Verbatim)

> If not otherwise stated in Section 7, SCIM attributes have the following characteristics:
>
> - "required" is "false"
> - "canonicalValues": none assigned
> - "caseExact" is "false"
> - "mutability" is "readWrite"
> - "returned" is "default"
> - "uniqueness" is "none"
> - "type" is "string"

## §2.3.2 - Booleans

> A boolean has no case sensitivity or uniqueness.

*(This means `uniqueness` SHOULD NOT be specified on boolean attributes.)*

## §2.3.7 - References

> A reference is case exact.

## §2.3.8 - Complex

> A complex attribute has no uniqueness or case sensitivity.

## §2.4 - Multi-Valued Attribute Default Sub-Attributes (Verbatim)

> If not otherwise defined, the default set of sub-attributes for a multi-valued attribute is as follows:
>
> **type** - A label indicating the attribute's function, e.g., "work" or "home".
>
> **primary** - A Boolean value indicating the 'primary' or preferred attribute value for this attribute.
>
> **display** - A human-readable name, primarily used for display purposes and having a mutability of "immutable".
>
> **value** - The attribute's significant value, e.g., email address, phone number.
>
> **$ref** - The reference URI of a target resource, if the attribute is a reference.

**⚠️ RFC Internal Inconsistency**: §2.4 says `display` has `mutability: "immutable"`, but §8.7.1 schema representations specify `mutability: "readWrite"` for `display` sub-attributes. The §8.7.1 representation takes precedence as the normative schema definition.

---

## §3.1 - Common Attributes (Verbatim Characteristics)

### `id`
- "Each representation of the resource MUST include a non-empty 'id' value."
- "MUST be unique across the SCIM service provider's entire set of resources"
- "MUST NOT be specified by the client"
- `caseExact: true`
- `mutability: "readOnly"`
- `returned: "always"`
- **Note**: §3.1 does NOT specify `required` for `id`. Since `mutability: "readOnly"` means the server assigns it, `required: false` is the correct schema characteristic (clients don't provide it).
- **Note**: `id` is a common attribute - "not defined in any particular schema" per §3.1. §3.1 says "For backward compatibility, some existing schema definitions MAY list common attributes as part of the schema."

### `externalId`
- `caseExact: true`
- `mutability: "readWrite"`
- "This attribute is OPTIONAL"

### `meta`
- "All 'meta' sub-attributes are assigned by the service provider (have a 'mutability' of 'readOnly'), and all of these sub-attributes have a 'returned' characteristic of 'default'."
- **meta.resourceType**: `mutability: "readOnly"`, `caseExact: true`
- **meta.created**: `mutability: "readOnly"`, MUST be a DateTime
- **meta.lastModified**: `mutability: "readOnly"`
- **meta.location**: `mutability: "readOnly"`, a reference (URI)
- **meta.version**: `caseExact: true`

---

## §8.7.1 - User Schema Representation (Normative JSON Extract)

**Schema URI**: `urn:ietf:params:scim:schemas:core:2.0:User`

### User Attributes (in RFC order)

**Note**: `id`, `externalId`, and `meta` are NOT listed in §8.7.1 - they are common attributes from §3.1.

```json
[
  {
    "name": "userName",
    "type": "string",
    "multiValued": false,
    "required": true,
    "caseExact": false,
    "mutability": "readWrite",
    "returned": "default",
    "uniqueness": "server"
  },
  {
    "name": "name",
    "type": "complex",
    "multiValued": false,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "uniqueness": "none",
    "subAttributes": [
      { "name": "formatted", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "familyName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "givenName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "middleName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "honorificPrefix", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "honorificSuffix", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" }
    ]
  },
  { "name": "displayName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "nickName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "profileUrl", "type": "reference", "referenceTypes": ["external"], "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "title", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "userType", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "preferredLanguage", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "locale", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  { "name": "timezone", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
  {
    "name": "active",
    "type": "boolean",
    "multiValued": false,
    "required": false,
    "mutability": "readWrite",
    "returned": "default"
  },
  {
    "name": "password",
    "type": "string",
    "multiValued": false,
    "required": false,
    "caseExact": false,
    "mutability": "writeOnly",
    "returned": "never",
    "uniqueness": "none"
  },
  {
    "name": "emails",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "uniqueness": "none",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["work", "home", "other"], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "phoneNumbers",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["work", "home", "mobile", "fax", "pager", "other"], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "ims",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["aim", "gtalk", "icq", "xmpp", "msn", "skype", "qq", "yahoo"], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "photos",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "reference", "referenceTypes": ["external"], "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["photo", "thumbnail"], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "addresses",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "uniqueness": "none",
    "subAttributes": [
      { "name": "formatted", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "streetAddress", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "locality", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "region", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "postalCode", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "country", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["work", "home", "other"], "mutability": "readWrite", "returned": "default", "uniqueness": "none" }
    ]
  },
  {
    "name": "groups",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readOnly",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readOnly", "returned": "default", "uniqueness": "none" },
      { "name": "$ref", "type": "reference", "referenceTypes": ["User", "Group"], "multiValued": false, "required": false, "caseExact": false, "mutability": "readOnly", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readOnly", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["direct", "indirect"], "mutability": "readOnly", "returned": "default", "uniqueness": "none" }
    ]
  },
  {
    "name": "entitlements",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "roles",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": [], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  },
  {
    "name": "x509Certificates",
    "type": "complex",
    "multiValued": true,
    "required": false,
    "caseExact": false,
    "mutability": "readWrite",
    "returned": "default",
    "subAttributes": [
      { "name": "value", "type": "binary", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "display", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": [], "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
      { "name": "primary", "type": "boolean", "multiValued": false, "required": false, "mutability": "readWrite", "returned": "default" }
    ]
  }
]
```

**Key observations about the RFC §8.7.1 User schema**:
1. `id`, `externalId`, `meta` are NOT listed - they are common attributes from §3.1
2. `uniqueness` is NOT specified on boolean attributes (`active`, `primary` sub-attrs) - per §2.3.2, booleans have "no uniqueness"
3. `uniqueness` is NOT specified on all parent-level multi-valued attrs - inconsistent (emails has it, phoneNumbers doesn't)
4. `display` sub-attribute IS present on emails, phoneNumbers, ims, photos, groups, entitlements, roles, x509Certificates
5. `emails.value.required = false`, `emails.value.returned = "default"` - NOT `true`/`"always"`
6. `userName.returned = "default"` - NOT `"always"`

---

## §8.7.1 - Group Schema Representation (Normative JSON Extract)

**Schema URI**: `urn:ietf:params:scim:schemas:core:2.0:Group`

```json
{
  "id": "urn:ietf:params:scim:schemas:core:2.0:Group",
  "name": "Group",
  "description": "Group",
  "attributes": [
    {
      "name": "displayName",
      "type": "string",
      "multiValued": false,
      "description": "A human-readable name for the Group. REQUIRED.",
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "members",
      "type": "complex",
      "multiValued": true,
      "description": "A list of members of the Group.",
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "subAttributes": [
        { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "immutable", "returned": "default", "uniqueness": "none" },
        { "name": "$ref", "type": "reference", "referenceTypes": ["User", "Group"], "multiValued": false, "required": false, "caseExact": false, "mutability": "immutable", "returned": "default", "uniqueness": "none" },
        { "name": "type", "type": "string", "multiValued": false, "required": false, "caseExact": false, "canonicalValues": ["User", "Group"], "mutability": "immutable", "returned": "default", "uniqueness": "none" }
      ]
    }
  ]
}
```

**Key observations about the RFC §8.7.1 Group schema**:
1. `displayName.required = false` in schema (⚠️ contradicts §4.2 prose which says "REQUIRED")
2. `displayName.returned = "default"`, `displayName.uniqueness = "none"` - NOT `"always"` / `"server"`
3. `members` has only 3 sub-attributes: `value`, `$ref`, `type` - NO `display` sub-attribute
4. `members.value.required = false`, `members.value.returned = "default"` - NOT `true` / `"always"`
5. `members.type.canonicalValues = ["User", "Group"]` - our implementation omits these
6. No `id`, `externalId`, `meta` in the schema attributes (common attributes per §3.1)

---

## §8.7.1 - Enterprise User Schema Representation (Normative JSON Extract)

**Schema URI**: `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`

```json
{
  "id": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
  "name": "EnterpriseUser",
  "description": "Enterprise User",
  "attributes": [
    { "name": "employeeNumber", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
    { "name": "costCenter", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
    { "name": "organization", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
    { "name": "division", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
    { "name": "department", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
    {
      "name": "manager",
      "type": "complex",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default",
      "subAttributes": [
        { "name": "value", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
        { "name": "$ref", "type": "reference", "referenceTypes": ["User"], "multiValued": false, "required": false, "caseExact": false, "mutability": "readWrite", "returned": "default", "uniqueness": "none" },
        { "name": "displayName", "type": "string", "multiValued": false, "required": false, "caseExact": false, "mutability": "readOnly", "returned": "default", "uniqueness": "none" }
      ]
    }
  ]
}
```

**Key observations about the RFC §8.7.1 Enterprise User schema**:
1. All scalar attributes have explicit `uniqueness: "none"` ✅
2. `manager` sub-attributes all have explicit `uniqueness: "none"` and `caseExact: false` ✅
3. `manager.displayName.mutability = "readOnly"` ✅
4. `manager.$ref.referenceTypes = ["User"]` ✅

---

## §8.6 - ResourceType Representation (Normative JSON Extract)

```json
[
  {
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    "id": "User",
    "name": "User",
    "endpoint": "/Users",
    "description": "User Account",
    "schema": "urn:ietf:params:scim:schemas:core:2.0:User",
    "schemaExtensions": [
      {
        "schema": "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User",
        "required": true
      }
    ],
    "meta": {
      "location": "https://example.com/v2/ResourceTypes/User",
      "resourceType": "ResourceType"
    }
  },
  {
    "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
    "id": "Group",
    "name": "Group",
    "endpoint": "/Groups",
    "description": "Group",
    "schema": "urn:ietf:params:scim:schemas:core:2.0:Group",
    "meta": {
      "location": "https://example.com/v2/ResourceTypes/Group",
      "resourceType": "ResourceType"
    }
  }
]
```

**Note**: RFC example has `"required": true` for EnterpriseUser extension. Our implementation uses `false`, which is a server choice - both are valid.

---

## §8.5 - ServiceProviderConfig Representation (Normative JSON Extract)

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
  "documentationUri": "http://example.com/help/scim.html",
  "patch": { "supported": true },
  "bulk": { "supported": true, "maxOperations": 1000, "maxPayloadSize": 1048576 },
  "filter": { "supported": true, "maxResults": 200 },
  "changePassword": { "supported": true },
  "sort": { "supported": true },
  "etag": { "supported": true },
  "authenticationSchemes": [
    {
      "name": "OAuth Bearer Token",
      "description": "Authentication scheme using the OAuth Bearer Token Standard",
      "specUri": "http://www.rfc-editor.org/info/rfc6750",
      "documentationUri": "http://example.com/help/oauth.html",
      "type": "oauthbearertoken",
      "primary": true
    },
    {
      "name": "HTTP Basic",
      "description": "Authentication scheme using the HTTP Basic Standard",
      "specUri": "http://www.rfc-editor.org/info/rfc2617",
      "documentationUri": "http://example.com/help/httpBasic.html",
      "type": "httpbasic"
    }
  ],
  "meta": {
    "location": "https://example.com/v2/ServiceProviderConfig",
    "resourceType": "ServiceProviderConfig",
    "created": "2010-01-23T04:56:22Z",
    "lastModified": "2011-05-13T04:42:34Z",
    "version": "W/\"3694e05e9dff594\""
  }
}
```

---

## Key RFC Inconsistencies Discovered

| # | Issue | §2.4 Says | §8.7.1 Says | Resolution |
|---|---|---|---|---|
| 1 | `display` mutability | `"immutable"` | `"readWrite"` | §8.7.1 takes precedence (normative schema) |
| 2 | Group `displayName` required | §4.2: "REQUIRED" | `"required": false` | Schema representation takes precedence; REQUIRED refers to the resource, not the schema attribute |
| 3 | `uniqueness` on booleans | §2.3.2: "no uniqueness" | Not specified | Omission is correct - booleans have no uniqueness |
| 4 | `uniqueness` on parent multi-valued | Implied `"none"` | Inconsistent (emails: yes, phoneNumbers: no) | RFC is inconsistent; including is safer |
