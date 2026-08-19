# SCIM Attribute and Sub-Attribute Type Rules

> **Question this answers**: which attribute shapes are legal in SCIM - multi-valued, complex, complex-with-multi-valued, complex-inside-complex - and which are not, at every nesting level.
> **Normative sources**: [RFC 7643](https://www.rfc-editor.org/info/rfc7643) (Core Schema), [RFC 7644](https://www.rfc-editor.org/info/rfc7644) (Protocol), as **updated by** [RFC 9865](https://www.rfc-editor.org/info/rfc9865) (Oct 2025) and [RFC 9967](https://www.rfc-editor.org/info/rfc9967) (May 2026), **plus the verified errata** - see [Errata that settle the ambiguities](#9-errata-that-settle-the-ambiguities).
> **Mirrors**: [rfc7643.txt](rfc7643.txt), [rfc7644.txt](rfc7644.txt), [rfc9865.txt](rfc9865.txt), [rfc9967.txt](rfc9967.txt). Currency enforced by [rfc-manifest.json](rfc-manifest.json) + [scripts/sync-rfcs.ps1](../../scripts/sync-rfcs.ps1).
> **Status**: reference document. It describes the standard, records what SCIMServer does today, and - new in the 2026-07-31 revision - restates the rules as a [machine-checkable catalogue](#12-the-machine-checkable-rule-catalogue) with stable IDs, reports what those rules [actually find in two live estates](#13-measured-what-these-rules-find-in-a-live-estate), and documents the deliberate [`referenceTypes` divergence](#14-referencetypes-advertised-not-enforced). It still **does not change server behavior**.
> **Last verified against upstream**: 2026-07-31 (corpus + errata re-checked online: no text drift, no metadata drift, no newly verified errata).

---

## 1. The short answer

| # | Shape | Level | Legal? | One-line reason |
|---|---|---|---|---|
| 1 | Singular simple (`string`, `boolean`, `decimal`, `integer`, `dateTime`, `binary`, `reference`) | top | **YES** | The base case. |
| 2 | **Multi-valued simple** (array of primitives) | top | **YES** | 7643 [section 2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4): elements may be "primitive values". |
| 3 | Singular complex | top | **YES** | e.g. `name`, `meta`, `manager`. |
| 4 | **Multi-valued complex** (array of objects) | top | **YES** | e.g. `emails`, `addresses`, `members`. This is the workhorse of SCIM. |
| 5 | Singular simple | sub | **YES** | The definition of a sub-attribute. |
| 6 | **Multi-valued simple** (array of primitives) | sub | **YES** | 7643 [section 1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2): a simple attribute is "singular **or multi-valued**". |
| 7 | Singular complex | sub | **NO** | 7643 [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) MUST NOT. |
| 8 | Multi-valued complex | sub | **NO** | Same MUST NOT. |
| 9 | Anything at all | sub-sub | **NO** | There is no third level. |

**The rule in one sentence: multi-valuedness is free at both levels; complexity is free only at the first.**

Depth is capped at exactly two: `attribute -> sub-attribute`. Both the schema language and the protocol's path grammar say so, independently.

---

## 2. Where the rule comes from

Three definitions in RFC 7643 [section 1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2) do all the work. Quoted verbatim from [rfc7643.txt](rfc7643.txt):

> **Simple Attribute**
>    A singular or multi-valued attribute whose value is a primitive,
>    e.g., "String".  A simple attribute MUST NOT contain
>    sub-attributes.
>
> **Complex Attribute**
>    A singular or multi-valued attribute whose value is a composition
>    of one or more simple attributes; e.g., "addresses" has the
>    sub-attributes "streetAddress", "locality", "postalCode", and
>    "country".
>
> **Sub-Attribute**
>    A simple attribute that is contained within a complex attribute.

Read those together and the whole model falls out:

- A sub-attribute is by definition **simple**, and simple explicitly includes **multi-valued**. So an array-of-primitives sub-attribute is legal.
- A complex attribute is composed of **simple** attributes. So a complex sub-attribute is a contradiction in terms.

RFC 7643 then states it as a hard requirement in [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8):

> A complex attribute MUST NOT contain sub-attributes
> that have sub-attributes (i.e., that are complex).

And [section 2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) defines what a multi-valued attribute's elements may be:

> Multi-valued attributes contain a list of elements using the JSON
> array format defined in Section 5 of [RFC7159].  Elements can be
> either of the following:
>
> o  primitive values, or
>
> o  objects with a set of sub-attributes and values ... in which case
>    they SHALL be considered to be complex attributes.

### The type lattice

```mermaid
flowchart TD
    A["Attribute<br/>(top level, inside a schema)"]

    A --> S1["type != complex<br/>multiValued = false<br/><b>SIMPLE SINGULAR</b>"]
    A --> S2["type != complex<br/>multiValued = true<br/><b>SIMPLE MULTI-VALUED</b>"]
    A --> C1["type = complex<br/>multiValued = false<br/><b>COMPLEX SINGULAR</b>"]
    A --> C2["type = complex<br/>multiValued = true<br/><b>COMPLEX MULTI-VALUED</b>"]

    S1 --> L1["ALLOWED<br/>userName, active, title"]
    S2 --> L2["ALLOWED<br/>schemas, canonicalValues"]
    C1 --> L3["ALLOWED<br/>name, meta, manager"]
    C2 --> L4["ALLOWED<br/>emails, addresses, members"]

    C1 --> SUB["subAttributes[]<br/>(level 2)"]
    C2 --> SUB

    SUB --> B1["type != complex<br/>multiValued = false<br/><b>ALLOWED</b><br/>value, type, primary, display"]
    SUB --> B2["type != complex<br/>multiValued = true<br/><b>ALLOWED</b><br/>canonicalValues, referenceTypes, eventUris"]
    SUB --> B3["type = complex<br/><b>FORBIDDEN</b><br/>RFC 7643 section 2.3.8"]

    B3 --> X["No level 3 exists.<br/>Errata 8415 removed 'complex'<br/>from the legal subAttributes.type values."]
```

---

## 3. The exhaustive combination matrix

Every combination of **level** x **cardinality** x **type**. This is the complete decision table; there are no other cases.

| Level | `multiValued` | `type` | Verdict | Normative citation | Canonical example |
|---|---|---|---|---|---|
| 1 (attribute) | `false` | `string` / `boolean` / `decimal` / `integer` / `dateTime` / `binary` / `reference` | **ALLOWED** | [7643 s2.3](https://www.rfc-editor.org/rfc/rfc7643#section-2.3) | `userName`, `active`, `profileUrl` |
| 1 | `true` | any non-complex | **ALLOWED** | [7643 s2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) first bullet | `schemas` (array of strings) |
| 1 | `false` | `complex` | **ALLOWED** | [7643 s2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) | `name`, `meta`, `manager`, `patch` |
| 1 | `true` | `complex` | **ALLOWED** | [7643 s2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) second bullet | `emails`, `addresses`, `members`, `authenticationSchemes` |
| 2 (sub-attribute) | `false` | any non-complex | **ALLOWED** | [7643 s1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2) | `emails.value`, `name.givenName`, `meta.created` |
| 2 | `true` | any non-complex | **ALLOWED** | [7643 s1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2) "singular **or multi-valued**" | `attributes.canonicalValues`, `attributes.referenceTypes`, `securityEvents.eventUris` |
| 2 | `false` | `complex` | **FORBIDDEN** | [7643 s2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) + [errata 8415](https://errata.rfc-editor.org/eid8415/) | - |
| 2 | `true` | `complex` | **FORBIDDEN** | same | - |
| 3+ | any | any | **UNREACHABLE** | Level 3 can only exist under a level-2 complex, which is forbidden | - |

### Cardinality is orthogonal to complexity

This is the point people most often get backwards, so it is worth its own table. "Can it be an array?" and "can it have sub-fields?" are independent questions with different answers per level.

| | Level 1 attribute | Level 2 sub-attribute |
|---|---|---|
| **Can be multi-valued?** | YES | **YES** |
| **Can be complex?** | YES | **NO** |

So `complex + multiValued` is legal at level 1 (that is `emails`), and `simple + multiValued` is legal at level 2 (that is `referenceTypes`). What is never legal is `complex` at level 2, in either cardinality.

---

## 4. Allowed combinations, with worked JSON

Every schema fragment below is a valid SCIM schema attribute definition, and every instance fragment is a valid resource payload.

### A1. Simple singular attribute

```json
{
  "name": "userName",
  "type": "string",
  "multiValued": false,
  "description": "Unique identifier for the User.",
  "required": true,
  "caseExact": false,
  "mutability": "readWrite",
  "returned": "default",
  "uniqueness": "server"
}
```

Instance:

```json
{
  "userName": "bjensen@example.com"
}
```

### A2. Simple multi-valued attribute (array of primitives)

RFC 7643 [section 2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) explicitly permits elements that are "primitive values". The `schemas` attribute on every resource is exactly this.

```json
{
  "name": "tags",
  "type": "string",
  "multiValued": true,
  "description": "Free-form labels attached to this User.",
  "required": false,
  "caseExact": false,
  "mutability": "readWrite",
  "returned": "default",
  "uniqueness": "none"
}
```

Instance:

```json
{
  "tags": [
    "contractor",
    "emea",
    "night-shift"
  ]
}
```

> **Interop caution.** Legal, but neither Entra ID nor Okta can map into an array of bare primitives. In practice a primitive array is read-mostly. See [IdP and ISV reality](#8-idp-and-isv-reality).

### A3. Complex singular attribute

```json
{
  "name": "name",
  "type": "complex",
  "multiValued": false,
  "description": "The components of the user's real name.",
  "required": false,
  "mutability": "readWrite",
  "returned": "default",
  "subAttributes": [
    {
      "name": "givenName",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "familyName",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    }
  ]
}
```

Instance:

```json
{
  "name": {
    "givenName": "Barbara",
    "familyName": "Jensen"
  }
}
```

### A4. Complex multi-valued attribute

The single most common shape in SCIM. Note that `emails` is `complex` AND `multiValued`, and every one of its sub-attributes is simple.

```json
{
  "name": "emails",
  "type": "complex",
  "multiValued": true,
  "description": "Email addresses for the user.",
  "required": false,
  "mutability": "readWrite",
  "returned": "default",
  "subAttributes": [
    {
      "name": "value",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "display",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "type",
      "type": "string",
      "multiValued": false,
      "required": false,
      "caseExact": false,
      "canonicalValues": [
        "work",
        "home",
        "other"
      ],
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "primary",
      "type": "boolean",
      "multiValued": false,
      "required": false,
      "mutability": "readWrite",
      "returned": "default"
    }
  ]
}
```

Instance:

```json
{
  "emails": [
    {
      "value": "bjensen@example.com",
      "type": "work",
      "primary": true
    },
    {
      "value": "babs@jensen.org",
      "type": "home"
    }
  ]
}
```

### A5. Multi-valued SIMPLE sub-attribute (the case people wrongly assume is illegal)

A sub-attribute may be an array of primitives. RFC 7643 proves this in its own schema-of-schemas: `attributes.canonicalValues` and `attributes.referenceTypes` are both `multiValued: true` strings living inside the complex `attributes` attribute ([section 8.7.2](https://www.rfc-editor.org/rfc/rfc7643#section-8.7.2)), and [errata 5607](https://errata.rfc-editor.org/eid5607/) (Verified) corrects `referenceTypes` inside `subAttributes` to `multiValued: true`.

```json
{
  "name": "licenses",
  "type": "complex",
  "multiValued": true,
  "description": "License grants held by this User.",
  "required": false,
  "mutability": "readWrite",
  "returned": "default",
  "subAttributes": [
    {
      "name": "value",
      "type": "string",
      "multiValued": false,
      "required": true,
      "caseExact": false,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    },
    {
      "name": "skus",
      "type": "string",
      "multiValued": true,
      "description": "SKU codes bundled into this license. A multi-valued SIMPLE sub-attribute, which RFC 7643 section 1.2 permits.",
      "required": false,
      "caseExact": true,
      "mutability": "readWrite",
      "returned": "default",
      "uniqueness": "none"
    }
  ]
}
```

Instance:

```json
{
  "urn:example:params:scim:schemas:extension:2.0:User": {
    "licenses": [
      {
        "value": "E5",
        "skus": [
          "EXCHANGE",
          "TEAMS",
          "INTUNE"
        ]
      }
    ]
  }
}
```

### A6. A multi-valued simple sub-attribute in a 2026 RFC

Not a legacy quirk. RFC 9967 [section 4](https://www.rfc-editor.org/rfc/rfc9967#section-4) adds `securityEvents` to `ServiceProviderConfig` with exactly this shape: a complex attribute whose `eventUris` sub-attribute is "a multivalued string".

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"
  ],
  "securityEvents": {
    "asyncRequest": "request",
    "eventUris": [
      "urn:ietf:params:scim:event:prov:create:full",
      "urn:ietf:params:scim:event:prov:patch:notice",
      "urn:ietf:params:scim:event:prov:delete"
    ]
  }
}
```

### A7. Reference-typed sub-attribute

`reference` is a simple type ([section 2.3.7](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.7)), so `$ref` is a perfectly ordinary sub-attribute. It is how SCIM models a relationship without nesting.

```json
{
  "members": [
    {
      "value": "2819c223-7f76-453a-919d-413861904646",
      "$ref": "https://example.com/v2/Users/2819c223-7f76-453a-919d-413861904646",
      "type": "User",
      "display": "Babs Jensen"
    }
  ]
}
```

### A8. Binary-typed sub-attribute

`binary` is a legal type at both levels. It was missing from the `type` keyword list in the published text and was added by [errata 5606](https://errata.rfc-editor.org/eid5606/) and [errata 8435](https://errata.rfc-editor.org/eid8435/), both Verified.

```json
{
  "x509Certificates": [
    {
      "value": "MIIDQzCCAqygAwIBAgICEAAwDQYJKoZIhvcNAQEFBQAwTjELMAkGA1UEBhMCVVMx",
      "type": "work",
      "primary": true
    }
  ]
}
```

---

## 5. Forbidden combinations, with worked JSON

Each case shows the illegal shape, the citation, and the SCIM error a strict service provider should return per RFC 7644 [section 3.12](https://www.rfc-editor.org/rfc/rfc7644#section-3.12).

### F1. Complex sub-attribute (singular)

The archetypal violation. `address` is complex, and `geo` inside it is complex again.

```jsonc
// SCHEMATIC - this is what NOT to publish. Not valid SCIM.
{
  "name": "address",
  "type": "complex",
  "multiValued": false,
  "subAttributes": [
    { "name": "street", "type": "string", "multiValued": false },
    {
      "name": "geo",
      "type": "complex",              // <-- FORBIDDEN: RFC 7643 section 2.3.8
      "multiValued": false,
      "subAttributes": [
        { "name": "lat", "type": "decimal", "multiValued": false },
        { "name": "lon", "type": "decimal", "multiValued": false }
      ]
    }
  ]
}
```

**Why**: [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) - "A complex attribute MUST NOT contain sub-attributes that have sub-attributes (i.e., that are complex)." Reinforced by [errata 8415](https://errata.rfc-editor.org/eid8415/), which struck `"complex"` from the legal values of `subAttributes.type`.

**Practical consequence**: `address.geo.lat` is not expressible in the PATCH path grammar, so no client can ever write it. See [section 6](#6-the-protocol-independently-forbids-a-third-level).

### F2. Complex multi-valued sub-attribute

```jsonc
// SCHEMATIC - not valid SCIM.
{
  "name": "employment",
  "type": "complex",
  "multiValued": false,
  "subAttributes": [
    { "name": "employer", "type": "string", "multiValued": false },
    {
      "name": "roles",
      "type": "complex",              // <-- FORBIDDEN, and multiValued makes it worse
      "multiValued": true,
      "subAttributes": [
        { "name": "title", "type": "string", "multiValued": false }
      ]
    }
  ]
}
```

Same prohibition. Multi-valuedness does not rescue it; the problem is `type: "complex"` at level 2.

### F3. A payload that implies a third level

Even against a schema that never declared it, this instance is invalid because `manager` is complex and `value` must be simple:

```json
{
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "manager": {
      "value": {
        "id": "26118915-6090-4610-87e4-49d8ca9f808d",
        "tenant": "contoso"
      }
    }
  }
}
```

Expected rejection:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:Error"
  ],
  "scimType": "invalidValue",
  "detail": "Attribute 'manager.value' must be a string; got an object. A sub-attribute cannot be complex (RFC 7643 section 2.3.8).",
  "status": "400"
}
```

### F4. Sub-attributes on a simple attribute

```jsonc
// SCHEMATIC - not valid SCIM.
{
  "name": "displayName",
  "type": "string",                   // simple ...
  "multiValued": false,
  "subAttributes": [                  // <-- FORBIDDEN: a simple attribute
    { "name": "locale", "type": "string" }   //     MUST NOT contain sub-attributes
  ]
}
```

**Why**: [section 1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2) - "A simple attribute MUST NOT contain sub-attributes." Note the asymmetry with `complex`: [section 7](https://www.rfc-editor.org/rfc/rfc7643#section-7) says a complex attribute **SHOULD** have `subAttributes`, so omitting them is merely poor practice, whereas adding them to a simple attribute is a violation.

### F5. Array of arrays

```json
{
  "tags": [
    [
      "a",
      "b"
    ],
    [
      "c"
    ]
  ]
}
```

**Why**: [section 2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) allows exactly two element kinds - primitives or objects-with-sub-attributes. A nested array is neither. There is no `multiValued` depth beyond one either, since `multiValued` is a boolean, not a rank.

### F6. `uniqueness` or `caseExact` on a complex attribute

```jsonc
// SCHEMATIC - characteristic misuse.
{
  "name": "emails",
  "type": "complex",
  "multiValued": true,
  "uniqueness": "server",             // <-- complex attributes have no uniqueness
  "caseExact": true                   // <-- and no case sensitivity
}
```

**Why**: [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) - "A complex attribute has no uniqueness or case sensitivity." The published text of [section 8.7.1](https://www.rfc-editor.org/rfc/rfc7643#section-8.7.1) contradicted itself here by putting `"uniqueness": "none"` on `name`, `emails` and `addresses`; [errata 6004](https://errata.rfc-editor.org/eid6004/) (Verified) removes it. Uniqueness belongs on the **sub-attribute** (`emails.value`), never on the container.

---

## 6. The protocol independently forbids a third level

Even if a server invented a three-level schema, no client could address it. RFC 7644 [section 3.5.2](https://www.rfc-editor.org/rfc/rfc7644#section-3.5.2) defines the PATCH path grammar:

```text
PATH = attrPath / valuePath [subAttr]
attrPath  = [URI ":"] ATTRNAME *1subAttr
valuePath = attrPath "[" valFilter "]"
subAttr   = "." ATTRNAME
ATTRNAME  = ALPHA *(nameChar)
nameChar  = "$" / "-" / "_" / DIGIT / ALPHA
```

`*1subAttr` means **at most one** `.name` segment. `ATTRNAME` itself cannot contain a dot. So `address.geo.lat` cannot parse, full stop. The same two-level ceiling applies to:

- `?attributes=` / `?excludedAttributes=` projection ([section 3.4.2.5](https://www.rfc-editor.org/rfc/rfc7644#section-3.4.2.5)),
- filters, where a `valuePath` may not be nested inside another `valuePath` ([section 3.4.2.2](https://www.rfc-editor.org/rfc/rfc7644#section-3.4.2.2)).

```mermaid
flowchart LR
    P["PATCH path"] --> Q1{"contains a<br/>value filter?"}
    Q1 -->|no| A1["attrPath"]
    Q1 -->|yes| A2["valuePath"]

    A1 --> R1["emails<br/>level 1 only"]
    A1 --> R2["name.givenName<br/>levels 1 + 2"]
    A2 --> R3["emails[type eq #quot;work#quot;]<br/>level 1, element selected"]
    A2 --> R4["emails[type eq #quot;work#quot;].value<br/>levels 1 + 2"]

    R2 --> STOP["*1subAttr allows ONE dot.<br/>A second dot cannot parse."]
    R4 --> STOP
    STOP --> NO["address.geo.lat is<br/>UNADDRESSABLE by design"]
```

So the schema rule and the protocol grammar are the same constraint expressed twice, in two documents. That redundancy is the strongest signal that two levels is intentional, not an oversight.

---

## 7. The exceptions, the traps, and the legal escape hatches

### 7.1 The one RFC-sanctioned exception: the `Schema` resource itself

RFC 7643 [section 7](https://www.rfc-editor.org/rfc/rfc7643#section-7) carves itself out:

> Unlike other core resources, the "Schema" resource MAY contain a
> complex object within a sub-attribute, and all attributes are
> REQUIRED unless otherwise specified.

That is why `attributes[].subAttributes[]` exists at all: `attributes` is complex, and `subAttributes` inside it is complex. Without the carve-out, schemas could not be published in SCIM's own format.

This is an explicit, single-purpose exemption for the meta-schema. It is **not** licence for data resources, and [errata 8415](https://errata.rfc-editor.org/eid8415/) confirms that reading by removing `complex` from the values a `subAttributes` entry may declare.

### 7.2 The trap: an extension URN is not an attribute

This payload has three levels of JSON nesting and is completely legal:

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"
  ],
  "userName": "bjensen@example.com",
  "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User": {
    "manager": {
      "value": "26118915-6090-4610-87e4-49d8ca9f808d",
      "$ref": "../Users/26118915-6090-4610-87e4-49d8ca9f808d",
      "displayName": "John Smith"
    }
  }
}
```

The outer key is a **schema namespace container** ([section 3.3](https://www.rfc-editor.org/rfc/rfc7643#section-3.3)), not an attribute. Counting attributes: `manager` is level 1, `value` is level 2. Nothing is at level 3.

```mermaid
flowchart TD
    R["Resource JSON"] --> CORE["Core attributes<br/>userName, name, emails"]
    R --> EXT["urn:...:extension:enterprise:2.0:User<br/><b>namespace container, NOT an attribute</b>"]

    CORE --> C1["name<br/>level 1 complex"]
    C1 --> C2["givenName<br/>level 2 simple"]

    EXT --> E1["manager<br/>level 1 complex"]
    E1 --> E2["value / $ref / displayName<br/>level 2 simple"]

    E2 --> NOTE["3 levels of JSON braces,<br/>only 2 levels of ATTRIBUTE.<br/>This is the legal escape hatch."]
```

### 7.3 Three legal ways to model deeper data

```mermaid
flowchart TD
    NEED["I have data that is<br/>3+ levels deep"] --> Q{"Is the inner object<br/>an entity in its own right?"}

    Q -->|yes| P2["Pattern 2:<br/>separate ResourceType<br/>+ reference sub-attribute"]
    Q -->|no| Q2{"Does it group<br/>cleanly by namespace?"}

    Q2 -->|yes| P1["Pattern 1:<br/>another extension schema URN"]
    Q2 -->|no| P3["Pattern 3:<br/>flatten into sibling<br/>sub-attributes"]

    P1 --> OK1["Filterable, PATCH-addressable"]
    P2 --> OK2["Filterable, PATCH-addressable,<br/>independently queryable"]
    P3 --> OK3["Filterable, PATCH-addressable,<br/>slightly ugly names"]

    BAD["Anti-pattern:<br/>JSON-encode the object<br/>into a string sub-attribute"] --> WHY["Works on the wire, but the<br/>payload is opaque to filters,<br/>PATCH paths and ?attributes=.<br/>All schema semantics are lost."]
```

**Pattern 1 - a second extension schema.** Adds a JSON level via the namespace container while staying at two attribute levels.

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User",
    "urn:example:params:scim:schemas:extension:2.0:UserLocation"
  ],
  "userName": "bjensen@example.com",
  "urn:example:params:scim:schemas:extension:2.0:UserLocation": {
    "building": "HQ-3",
    "geo": {
      "latitude": "47.6062",
      "longitude": "-122.3321"
    }
  }
}
```

**Pattern 2 - a separate ResourceType plus a reference.** The RFC's intended answer for genuinely hierarchical data; this is exactly how `manager` and `members` work.

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User"
  ],
  "userName": "bjensen@example.com",
  "urn:example:params:scim:schemas:extension:2.0:User": {
    "workspace": {
      "value": "8f2c1d64-6b3a-4a0e-9a11-b7e7c0d4b912",
      "$ref": "https://example.com/v2/Workspaces/8f2c1d64-6b3a-4a0e-9a11-b7e7c0d4b912",
      "display": "Building 3, Floor 2"
    }
  }
}
```

**Pattern 3 - flatten.** Ugly names, but every field stays filterable and PATCH-addressable.

```json
{
  "urn:example:params:scim:schemas:extension:2.0:User": {
    "geoLatitude": "47.6062",
    "geoLongitude": "-122.3321"
  }
}
```

---

## 8. IdP and ISV reality

The standard is the ceiling. Every major client sits **below** it, and the failure modes in the field are almost never "someone nested too deep" - they are "someone trimmed the sub-attribute set".

### Microsoft Entra ID

Source: [Tutorial: develop a SCIM endpoint](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups) (Understand the Microsoft Entra SCIM implementation).

| Behavior | Detail | Relative to RFC |
|---|---|---|
| Complex + multi-valued custom attributes | Supported | Conformant |
| **Breadth ceiling** | "Name/value attributes can be mapped to easily, but flowing data to complex attributes with **three or more subattributes** isn't supported." | **Stricter.** Design custom complex attributes as `{value, type}` or `{value, display}` pairs. |
| **Unique `type`** | "The `type` subattribute values of multivalued complex attributes must be unique." | **Stricter.** [Section 2.4](https://www.rfc-editor.org/rfc/rfc7643#section-2.4) only SHOULD-NOTs repeating the same `(type, value)` pair; Entra forbids two `emails` with `type: "work"` outright. |
| Mapping target grammar | `userName`, `name.givenName`, `emails[type eq "work"].value` | Exactly the RFC 7644 two-level path grammar. Nothing deeper is expressible. |
| Extension attributes | Addressed by fully-qualified flattened name, e.g. `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber` | Conformant framing |
| Filter operators | `eq` and `and` only | Subset |
| **Deviation** | Docs show `"manager": "123456"` - a bare string where the RFC expects `{"value": ...}` | Non-conformant; servers must tolerate |
| **Deviation** | PATCH `{"op":"Add","path":"manager","value":[{"$ref":...,"value":...}]}` wraps a **singular** complex in an array | Non-conformant; servers must tolerate |
| **Deviation** | `op` values capitalised (`Add` / `Replace` / `Remove`) | [Section 3.5.2](https://www.rfc-editor.org/rfc/rfc7644#section-3.5.2) values are lowercase; must be matched case-insensitively |
| **Keyword casing** | "Property values should be **camel cased** (for example, readWrite)." | Reinforces [D9](#12-the-machine-checkable-rule-catalogue): a characteristic keyword is a fixed token, not free text. Entra reads `/Schemas`, so a mis-cased `ReadWrite` is a real interop break, not a cosmetic one. |
| **Null hygiene** | "If a value isn't present, **don't send null values**." (schema discovery) | Reinforces [D10](#12-the-machine-checkable-rule-catalogue): a characteristic is a boolean or absent, never `null`. |
| **`$ref` is sent as `null`** | Group member PATCH bodies are `{"$ref": null, "value": "<id>"}` | **Decisive for `referenceTypes`.** Any server that validated reference targets would reject the single most common provisioning operation Entra performs. See [section 14](#14-referencetypes-advertised-not-enforced). |

### Okta

Source: [Okta and SCIM Version 2.0](https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/).

| Behavior | Detail |
|---|---|
| **No nested object type at all** *(claim NOT re-verified in the 2026-07-31 pass)* | Okta app-user profiles are documented elsewhere as supporting string, number, boolean, integer and arrays of those, with no authorable **complex** type. This claim originates from Okta's profile-attribute documentation, **not** from the SCIM guide cited above, and a re-read of that guide on 2026-07-31 neither confirmed nor contradicted it. Treat it as probable but unconfirmed. |
| Consequence (if the above holds) | Okta emits only the RFC-defined complex attributes (`name.*`, `emails[]`, `groups[]`, `members[]`). Every custom attribute is a flat scalar. |
| Implicit-path PATCH **(re-verified 2026-07-31)** | `{"op":"replace","value":{"active":false}}` with **no** `path`. Legal per [section 3.5.2](https://www.rfc-editor.org/rfc/rfc7644#section-3.5.2) but frequently mishandled by servers. |
| `members` returned as `null` **(re-verified)** | Group responses may carry `"members": null`; Okta explicitly does not require the member list back. |
| Update verb | PUT for most updates; PATCH only for activate / deactivate / password sync on OIN integrations. |

### Slack

Source: [Using the Slack SCIM API](https://docs.slack.dev/admins/scim-api) (page updated 2025-12-05).

| Behavior | Detail | Relative to RFC |
|---|---|---|
| **Silently drops a sub-attribute** | "Slack does not store `type` for `addresses`. The `type` field will be used to determine which address is the primary address if the request does not specify one, however the `type` is **not stored**." | A sub-attribute is accepted, used, then discarded. A client that round-trips `addresses[].type` will find it missing. |
| **All-or-nothing custom profile** | "When creating a new user, if anything in custom profile is invalid, **all profile fields will be dropped**." | Silent partial data loss rather than a `400`. The opposite of what [section 3.3](https://www.rfc-editor.org/rfc/rfc7644#section-3.3) expects. |
| Field cap | 50 custom profile fields maximum | Breadth ceiling, like Entra's |
| Content type | Documents `Content-Type: application/json`, not `application/scim+json` | Servers must accept both |

### Atlassian and AWS IAM Identity Center

Sources: [Atlassian user provisioning REST API](https://developer.atlassian.com/cloud/admin/user-provisioning/rest/intro/), [AWS IAM Identity Center SCIM](https://docs.aws.amazon.com/singlesignon/latest/developerguide/supported-apis.html).

Both publish **volume and lifecycle** limits (user caps per directory, group-size caps, no hard delete, restricted operation sets) and say **nothing** about attribute typing or nesting. That silence is itself the datapoint: the shape rules are so universally taken for granted that vendors do not think to document them. The interop surface everyone actually documents is *which attributes exist* and *which operations work*, never *how deep an attribute may nest*.

### Cross-vendor pattern summary

| Behavior | Prevalence | Notes |
|---|---|---|
| Two levels max, honoured | Near-universal | Mostly because the PATCH grammar leaves no choice |
| Complex sub-attributes published in `/Schemas` | Rare, always a bug | Usually a code generator that recursed a domain model. Clients then cannot PATCH those fields. |
| Multi-valued **simple** sub-attributes in custom extensions | Uncommon but legal | Safe per RFC; unmappable by Entra and Okta, so effectively read-only |
| **Trimming** the sub-attribute set (`emails` with only `value` + `type`) | **Very common** | The dominant real-world interop failure. A strict server answers `Unknown sub-attribute 'primary'`. See [OPENTEXT_ISV3_SCHEMA_SOURCE_VS_LIVE.md](../OPENTEXT_ISV3_SCHEMA_SOURCE_VS_LIVE.md). |
| Omitting `subAttributes` on a `complex` attribute | Common | [Section 7](https://www.rfc-editor.org/rfc/rfc7643#section-7) says SHOULD, not MUST, so technically conformant but useless for validation |
| Narrowing `canonicalValues` (e.g. `type` to `[work]`) | Common | Legal; rejects the RFC-suggested `home` / `other` |
| JSON-encoding an object into a string sub-attribute | Occasional workaround | Works, but opaque to filters, PATCH and projection |

---

## 9. Errata that settle the ambiguities

A mirrored `.txt` is the text **as published in 2015**. Errata change what it means without changing a byte. These are the ones that bear on attribute and sub-attribute typing. All links go to the RFC Editor errata system.

| Erratum | Status | Section | What it changes | Why it matters here |
|---|---|---|---|---|
| [8415](https://errata.rfc-editor.org/eid8415/) | **Verified** 2025-10-28 | 8.7.1 | Removes `"complex"` from the `canonicalValues` of `subAttributes.type`; adds `"binary"` | **The decisive one.** The published schema-of-schemas contradicted [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) and implementers used it to justify nesting. That loophole is now formally closed. |
| [5607](https://errata.rfc-editor.org/eid5607/) | **Verified** | 8.7.2 | `referenceTypes` inside `subAttributes` is `multiValued: true` | Direct normative proof that a **multi-valued simple sub-attribute** is legal. |
| [6004](https://errata.rfc-editor.org/eid6004/) | **Verified** | 8.7.1 | Removes `uniqueness` from the complex `name`, `emails`, `addresses` | Confirms complex attributes have no `uniqueness`; it belongs on the sub-attribute. |
| [5606](https://errata.rfc-editor.org/eid5606/) | **Verified** | 8.7.1 | Adds `binary` to the `type` canonical values | `binary` is legal at both levels. |
| [8435](https://errata.rfc-editor.org/eid8435/) | **Verified** | 7 | Adds `binary` to the prose list of valid `type` values | Same, in the prose. |
| [7522](https://errata.rfc-editor.org/eid7522/) | **Verified** | 8.7.2 | `schemaExtensions` is `multiValued: true` | Complex + multi-valued at level 1. |
| [5368](https://errata.rfc-editor.org/eid5368/) | **Verified** | 8.7.1 | `Group.displayName` is `required: true` | Characteristic correctness; see the Schema-Characteristic Test Rule in the repo instructions. |
| [8472](https://errata.rfc-editor.org/eid8472/) | **Verified** | 8.7.1 | `manager.value` is `caseExact: true` | A sub-attribute's characteristics are independent of its parent's. |
| [8471](https://errata.rfc-editor.org/eid8471/) | **Verified** | 8.7.1 | `groups.$ref` `referenceTypes` is `["Group"]`, not `["User","Group"]` | `referenceTypes` is itself a multi-valued simple sub-attribute of a sub-attribute definition. |
| [6011](https://errata.rfc-editor.org/eid6011/) | Reported | 8.7.1 | `Group.members` should declare a `display` sub-attribute | The published Group schema is missing a sub-attribute its own example uses. |
| [6001](https://errata.rfc-editor.org/eid6001/) | Held | 8.7.1 | `reference`-typed attributes should be `caseExact: true` | [Section 2.3.7](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.7): "A reference is case exact." |
| [8924](https://errata.rfc-editor.org/eid8924/) | Reported | 2.1 | `ATTRNAME` ABNF does not permit the leading `$` that `$ref` uses | The canonical sub-attribute name `$ref` does not match the published name grammar. |

Live counts are asserted by check **O3** of [scripts/sync-rfcs.ps1](../../scripts/sync-rfcs.ps1); a newly Verified erratum fails the gate and names it.

---

## 10. What RFC 9865 and RFC 9967 changed

Both update RFC 7643 and RFC 7644. **Neither relaxes the nesting rule**, and both add attributes that model the two-level pattern.

| RFC | Published | Adds | Shape |
|---|---|---|---|
| [RFC 9865](https://www.rfc-editor.org/rfc/rfc9865#section-4) | 2025-10 | `pagination` on `ServiceProviderConfig` | Complex singular; sub-attributes `cursor` (boolean), `index` (boolean), `defaultPaginationMethod` (string), `defaultPageSize` (integer), `maxPageSize` (integer), `cursorTimeout` (integer). All simple. |
| [RFC 9967](https://www.rfc-editor.org/rfc/rfc9967#section-4) | 2026-05 | `securityEvents` on `ServiceProviderConfig` | Complex singular; sub-attributes `asyncRequest` (string) and `eventUris` (**multi-valued** string). |

RFC 9865 also adds three `scimType` keywords to the RFC 7644 [section 3.12](https://www.rfc-editor.org/rfc/rfc7644#section-3.12) table (`invalidCursor`, `expiredCursor`, `invalidCount`), and RFC 9967 adds the `Set-Txn` response header and `Prefer: respond-async`.

`securityEvents.eventUris` is worth dwelling on: a 2026-vintage Standards Track RFC placing a multi-valued simple sub-attribute inside a complex attribute is the freshest possible confirmation that row 6 of the [combination matrix](#3-the-exhaustive-combination-matrix) is correct.

**Verified negative (2026-07-31).** Both mirrors were searched for every phrase that could carry a typing rule (`subAttributes`, `complex attribute`, `attribute characteristic`, `referenceTypes`, `2.3.8`). RFC 9865 returns **zero** matches; RFC 9967 returns **one**, and it is the prose defining `securityEvents` itself. So although both RFCs formally `Update: 7643, 7644`, **neither alters a single attribute-definition rule** - the rules in this document derive entirely from RFC 7643 plus its errata. This matters because "Updates:" in an RFC header is often read as "the old rules may have moved"; here, measurably, they have not.

---

## 11. Conformance checklist

For anyone authoring or reviewing a schema, in either direction. Each box cites
the rule ID from the [catalogue](#12-the-machine-checkable-rule-catalogue).

**Publishing a schema (`/Schemas`)**

- [ ] Every attribute declares `name`, `type`, `multiValued`, `required`.
- [ ] No attribute inside a `subAttributes` array has `type: "complex"`. **(D2)**
- [ ] No attribute inside a `subAttributes` array has its own `subAttributes`. **(D3)**
- [ ] No attribute with a non-`complex` `type` carries `subAttributes`. **(D4)**
- [ ] Every `complex` attribute has a non-empty `subAttributes`. **(D5, SHOULD)**
- [ ] No `complex` attribute carries a *meaningful* `uniqueness` or `caseExact`. **(D6 - read the nuance in the catalogue before enforcing this one.)**
- [ ] `referenceTypes` appears only on `type: "reference"` attributes. **(D7)**
- [ ] `type` keyword is one of the eight in [Table 1](https://www.rfc-editor.org/rfc/rfc7643#section-2.3). **(D1)**
- [ ] `mutability` / `returned` / `uniqueness` use the exact keyword spellings. **(D9)**
- [ ] `required` / `multiValued` / `caseExact` are booleans, never `null` or a string. **(D10)**
- [ ] Every attribute name matches `ATTRNAME`. **(D11 - `$ref` is the known exception.)**
- [ ] Multi-valued complex attributes define the sub-attributes they actually accept, including `primary` and `display` if clients may send them.
- [ ] Omitted characteristics are read as the [section 2.2](https://www.rfc-editor.org/rfc/rfc7643#section-2.2) defaults, not as "unsupported".

**Consuming a schema**

- [ ] Treat an absent characteristic as its [section 2.2](https://www.rfc-editor.org/rfc/rfc7643#section-2.2) default (`required` false, `caseExact` false, `mutability` readWrite, `returned` default, `uniqueness` none, `multiValued` false, `type` string).
- [ ] Do not assume `emails` has `display` or `primary`; many ISVs trim them.
- [ ] Do not assume canonical `type` values beyond what the schema publishes.
- [ ] Expect at most one `.` in any PATCH path you construct.
- [ ] Do not assume a sub-attribute you sent will come back. Slack accepts `addresses[].type`, uses it, and does not store it.

---

## 12. The machine-checkable rule catalogue

Sections 1 to 7 state the rules in prose. This section restates them as discrete,
testable predicates with stable IDs, so tests, gates and error messages can cite
one identifier instead of re-deriving the rule.

Two families, and the distinction is the important part:

- **P-rules** are about a **payload**. They can only be evaluated when a resource
  is created or modified, because they depend on what the client sent.
- **D-rules** are about a **schema definition**. They can be evaluated the moment
  a schema is written, with no payload in sight.

Conflating the two is the most common design error here. A complex sub-attribute
*declared* in a schema is a D-rule violation the instant it is registered; the
same declaration only becomes a P-rule violation if some client eventually sends
data for it. A server that only checks payloads will happily publish a schema
that no compliant client can ever PATCH.

### 12.1 P-rules (payload)

| ID | Predicate | Source | Strength |
|---|---|---|---|
| **P1** | A payload MUST NOT populate a sub-attribute whose definition is complex. | [2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8), [8415](https://errata.rfc-editor.org/eid8415/) | MUST |
| **P2** | A payload MAY populate a multi-valued **simple** sub-attribute with an array of primitives; each element is type-checked against the sub-attribute's `type`. | [1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2), [5607](https://errata.rfc-editor.org/eid5607/) | permitted |

### 12.2 D-rules (schema definition)

| ID | Predicate | Source | Strength | Safe to enforce? |
|---|---|---|---|---|
| **D1** | `type` is one of `string`, `boolean`, `decimal`, `integer`, `dateTime`, `binary`, `reference`, `complex`. | [2.3 Table 1](https://www.rfc-editor.org/rfc/rfc7643#section-2.3); [8435](https://errata.rfc-editor.org/eid8435/) adds `binary` to the [section 7](https://www.rfc-editor.org/rfc/rfc7643#section-7) prose, which lists only seven | MUST | yes |
| **D2** | An attribute inside `subAttributes` does not have `type: "complex"`. | [2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8), [8415](https://errata.rfc-editor.org/eid8415/) | MUST | yes |
| **D3** | An attribute inside `subAttributes` does not carry its own `subAttributes`. | [2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) | MUST | yes |
| **D4** | Only a `complex` attribute carries `subAttributes`. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7): *"When an attribute is of type complex, subAttributes defines a set of sub-attributes"* | MUST | yes |
| **D5** | A `complex` attribute carries a non-empty `subAttributes`. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7): *"there **SHOULD** be a corresponding schema attribute"* | SHOULD | **warn only** |
| **D6** | A `complex` attribute does not carry a **meaningful** `uniqueness` or `caseExact`. | [2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8): *"A complex attribute has no uniqueness or case sensitivity"*; [6004](https://errata.rfc-editor.org/eid6004/) | MUST | **only in the "meaningful" form - see below** |
| **D7** | `referenceTypes` appears only on `type: "reference"`. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7): *"only applicable for attributes that are of type reference"* | MUST | **document only** - see [section 14](#14-referencetypes-advertised-not-enforced) |
| **D8** | Each `referenceTypes` value is a resource-type name, `external`, or `uri`. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7) | MUST | **document only** |
| **D9** | `mutability` in {`readOnly`,`readWrite`,`immutable`,`writeOnly`}; `returned` in {`always`,`never`,`default`,`request`}; `uniqueness` in {`none`,`server`,`global`}. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7) | MUST | yes |
| **D10** | `required`, `multiValued`, `caseExact` are JSON booleans when present. | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7): *"A Boolean value"* | MUST | yes |
| **D11** | `name` matches `ATTRNAME = ALPHA *(nameChar)`, `nameChar = "$" / "-" / "_" / DIGIT / ALPHA`. | [2.1](https://www.rfc-editor.org/rfc/rfc7643#section-2.1) | MUST | yes, **with a `$ref` carve-out** |

### 12.3 The two traps in this table

**D6 is not what a literal reading suggests.** Section 2.3.8 says a complex
attribute *has* no uniqueness or case sensitivity, which reads as "the keys must
be absent". Real schemas - including the ones in this repository and the sample
in Entra's own documentation - routinely emit `uniqueness: "none"` and
`caseExact: false` on complex attributes as harmless defaults. Enforcing absence
would reject them. The enforceable form is therefore:

```text
violation  <=>  type == "complex"
                AND ( (uniqueness is present AND uniqueness != "none")
                      OR (caseExact is present AND caseExact == true) )
```

That is, a complex attribute may *mention* these characteristics at their default
values, but must not assert a **meaningful** one. Section 13 shows what happens
if you get this wrong: 228 false positives across two estates.

**D11 would reject `$ref` if applied literally.** `ATTRNAME` requires a leading
`ALPHA`, but `$ref` is a canonical SCIM sub-attribute name used throughout the
RFC's own schemas and by every IdP. This is open erratum
[8924](https://errata.rfc-editor.org/eid8924/) (*Reported*, not Verified). Any
implementation of D11 must carve out `$ref` explicitly, or it will reject the
specification's own examples.

### 12.4 Where each family can be evaluated

```mermaid
flowchart TD
    subgraph W["Schema write - admin plane"]
        A["PUT / PATCH endpoint profile"] --> B["validate profile"]
        B --> C{"D-rules<br/>D1 D2 D3 D4 D6 D9 D10 D11"}
        C -->|"violation"| D["400 - schema refused<br/>no resource data touched"]
        C -->|"D5 only"| E["warning - schema accepted"]
        C -->|"clean"| F["schema stored"]
    end

    subgraph R["Resource write - data plane"]
        G["POST / PUT / PATCH a User or Group"] --> H["resolve schema"]
        H --> I{"P1<br/>complex sub-attribute populated?"}
        I -->|"yes"| J["400 invalidValue"]
        I -->|"no"| K{"P2<br/>multi-valued simple sub-attribute?"}
        K -->|"yes"| L["type-check each element<br/>path attr.sub[index]"]
        K -->|"no"| M["existing single-value checks"]
    end

    F -.->|"schema now available to"| H
```

The dotted edge is the whole argument for having both families: a schema that
passes the admin plane is the contract the data plane then enforces. If the
admin plane never checks, the data plane is enforcing a contract that was never
validated.

### 12.5 What a violation looks like on the wire

A **D-rule** violation, refused at schema-write time:

```http
PATCH /scim/admin/endpoints/2f1c7b9e-0e5a-4a1b-9c33-6d2f0b8a4e77 HTTP/1.1
Host: scimserver.example.com
Authorization: Bearer <admin token>
Content-Type: application/json
```

```json
{
  "profile": {
    "schemas": [
      {
        "id": "urn:example:params:scim:schemas:extension:hr:2.0:User",
        "name": "HrUser",
        "attributes": [
          {
            "name": "address",
            "type": "complex",
            "multiValued": false,
            "required": false,
            "subAttributes": [
              {
                "name": "geo",
                "type": "complex",
                "multiValued": false,
                "required": false,
                "subAttributes": [
                  {
                    "name": "lat",
                    "type": "decimal",
                    "multiValued": false,
                    "required": false
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}
```

A **P-rule** violation, refused at resource-write time, for a schema that was
registered before the rules were switched on:

```http
POST /scim/endpoints/2f1c7b9e-0e5a-4a1b-9c33-6d2f0b8a4e77/Users HTTP/1.1
Host: scimserver.example.com
Authorization: Bearer <token>
Content-Type: application/scim+json
Accept: application/scim+json
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:schemas:core:2.0:User"
  ],
  "userName": "ada@example.com",
  "address": {
    "street": "1 Main St",
    "geo": {
      "lat": 47.6,
      "lon": -122.3
    }
  }
}
```

```http
HTTP/1.1 400 Bad Request
Content-Type: application/scim+json
```

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:Error"
  ],
  "status": "400",
  "scimType": "invalidValue",
  "detail": "Schema validation failed: address.geo: Sub-attribute 'geo' of complex attribute 'address' is itself complex, which RFC 7643 2.3.8 forbids."
}
```

### 12.6 Data transformation: the one shape whose *handling* changes

Every other rule either accepts or rejects. P2 is the only rule that changes how
a value is **interpreted**, so it is worth showing the transformation explicitly.

Given this sub-attribute definition:

```json
{
  "name": "skus",
  "type": "string",
  "multiValued": true,
  "required": false
}
```

```mermaid
flowchart LR
    A["client sends<br/>skus: ['SKU-A', 'SKU-B']"] --> B{"is the multi-valued<br/>simple sub-attribute honoured?"}
    B -->|"no - every sub-attribute<br/>treated as singular"| C["typeof value is 'object'<br/>expected 'string'"]
    C --> D["400 invalidValue<br/>'must be a string, got object'"]
    B -->|"yes - RFC 1.2 honoured"| E["treat as array;<br/>clone the definition<br/>with multiValued false"]
    E --> F["type-check element 0<br/>path licenses[0].skus[0]"]
    E --> G["type-check element 1<br/>path licenses[0].skus[1]"]
    F --> H["201 - stored and<br/>round-tripped as an array"]
    G --> H
```

The failure message under the first branch (*"must be a string, got object"*) is
worth memorising: it is what a server says when it has silently collapsed a legal
multi-valued sub-attribute into a singular one. It names a type mismatch, which
sends the reader hunting for a wrong value, when the real fault is a cardinality
assumption one level up.

---

## 13. Measured: what these rules find in a live estate

Rules derived from a specification are hypotheses until they meet real data. This
section records what happened when the eleven D-rules were evaluated against
every schema in two production estates on **2026-07-31**.

### 13.1 Method

For each endpoint, the full profile was fetched from the admin plane and every
attribute and sub-attribute walked recursively. The `Schema` resource itself was
excluded up front, per the [section 7.1 carve-out](#71-the-one-rfc-sanctioned-exception-the-schema-resource-itself).

D6 was evaluated **twice**, deliberately: once in the literal "characteristic is
present at all" form, and once in the "characteristic is present with a
meaningful value" form. Measuring both is what exposed the difference between
them.

To reproduce:

```powershell
$h = @{ Authorization = "Bearer $token" }
$list = Invoke-RestMethod -Uri "$base/scim/admin/endpoints" -Headers $h
foreach ($e in $list.endpoints) {
    # NOTE: the LIST response carries profileSummary only - the settings and
    # schemas live on the DETAIL resource. Counting from the list view silently
    # measures nothing.
    $detail = Invoke-RestMethod -Uri "$base/scim/admin/endpoints/$($e.id)" -Headers $h
    $detail.profile.schemas | ForEach-Object { <# walk attributes, apply D1..D11 #> }
}
```

### 13.2 Results

Scope: **108 endpoints, 666 schemas, 3,658 top-level attributes** across the dev
estate (58 endpoints) and the customer-facing production estate (50 endpoints).

> **Re-verified 2026-08-18 at v0.55.6, and the survey is only half re-confirmable.**
> The **dev** estate still measures **58 endpoints**, so that half stands - and it
> stands across a *tenant migration*, since dev has since moved from tenant 08 to
> tenant 09 (`purplecliff`) and carried its data with it. The **customer-facing
> production** estate was **unreachable** at the time of writing (TLS handshake
> failure, then timeout), so its 50-endpoint contribution could not be re-counted.
> That estate runs a single replica by deliberate cost policy, so unreachability is
> plausibly a billing pause rather than a fault - but it is **not verified either
> way here**, and the 108/666/3,658 totals should be read as *measured 2026-07-31*,
> not as *currently true*. The per-rule violation counts below are unaffected in
> the sense that they were real when taken; they are simply not re-measured.

| Rule | Violations | Reading |
|---|---|---|
| D1 `type` keyword | **0** | no schema anywhere uses an unknown type |
| D2 complex sub-attribute | **0** | **nobody nests.** The rule the whole document is about is violated by no one |
| D3 sub-attribute with `subAttributes` | **0** | same |
| D4 `subAttributes` on a non-complex attribute | **0** | |
| D5 `complex` with empty `subAttributes` | **0** | |
| D9 characteristic keywords | **0** | |
| D10 non-boolean characteristics | **0** | |
| **D6 literal form** ("present at all") | **228** | **would fire on a brand-new endpoint** |
| **D6 meaningful form** | **0** | safe |
| **D11 attribute name ABNF** | **2** | a real, live defect |

### 13.3 Finding 1 - the literal D6 would have rejected our own schemas

All 228 hits carry `uniqueness: "none"`, the default. The built-in schema
constants in this repository declare complex attributes with `uniqueness` on
three of them and `caseExact` on one. A validator implementing section 2.3.8
literally would therefore reject a **freshly created endpoint using the shipped
default schema** - a rule that fires on the server's own output before any
operator has done anything.

This is the strongest possible argument for measuring a rule against real data
before enforcing it. The rule is correct as written in the RFC; the enforceable
predicate is narrower than the sentence.

### 13.4 Finding 2 - D11 catches a genuine production defect

Two attributes on a live endpoint present in **both** estates are named:

```text
emails[type eq "work"].primary
phoneNumbers[type eq "work"].primary
```

Someone stored a **filter expression as an attribute name**. Neither name can
match `ATTRNAME`, so neither attribute can appear in a PATCH path, a filter, or
an `attributes=` projection - the very operations the names were written to
describe. It is inert data that looks like configuration.

Nothing else in the codebase would surface this. It is the clearest evidence that
D11 earns its place despite being the rule most likely to be dismissed as
pedantry.

### 13.5 What the measurement implies

- Enforcing D1 to D5, D9 and D10 is **zero-impact today**. They are purely
  preventive: they stop a class of schema that no one has authored yet.
- The **only** endpoint in either estate that would fail a strict pass is the one
  carrying the two malformed names.
- The distribution confirms the [cross-vendor pattern](#cross-vendor-pattern-summary):
  the field's problem is never over-nesting. It is trimming, dropping and
  mis-naming.

---

## 14. `referenceTypes`: advertised, not enforced

SCIMServer publishes `referenceTypes` in its schemas and does **not** act on it.
That is a deliberate, RFC-permitted divergence, and this section is the record of
it.

### 14.1 What the RFC says

| Aspect | RFC 7643 |
|---|---|
| Purpose | [7](https://www.rfc-editor.org/rfc/rfc7643#section-7): *"A multi-valued array of JSON strings that indicate the SCIM resource types that may be referenced."* |
| Legal values | a resource type name (e.g. `User`), `external`, or `uri` |
| Applicability | *"only applicable for attributes that are of type reference"* |
| Reference target | [2.3.7](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.7): *"A reference URI MUST be to an HTTP-addressable resource."* |
| Integrity | [2.3.7](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.7): a provider **MAY** choose to enforce referential integrity |

That last row is the licence: enforcement is optional, so declining to enforce is
conformant.

### 14.2 What SCIMServer does

| Behavior | Status |
|---|---|
| Publishes `referenceTypes` in `/Schemas` | **yes** - seven declarations in the built-in schemas |
| Checks the value is a string | yes - `reference` shares the string branch |
| Checks the value is an HTTP-addressable URI | **no** |
| Checks the target's resource type against `referenceTypes` | **no** |
| Enforces referential integrity | **no** (explicitly permitted) |
| Validates `referenceTypes` placement (D7) or values (D8) at schema-write time | **no** |

### 14.3 Why it stays that way

Because the dominant client sends `null`. Entra's documented group-membership
PATCH is:

```json
{
  "schemas": [
    "urn:ietf:params:scim:api:messages:2.0:PatchOp"
  ],
  "Operations": [
    {
      "op": "Add",
      "path": "members",
      "value": [
        {
          "$ref": null,
          "value": "f648f8d5ea4e4cd38e9c"
        }
      ]
    }
  ]
}
```

A server enforcing "a `reference` must be an HTTP-addressable URI" would reject
the single most common write Entra performs. Okta likewise returns `members`
as `null`. The RFC's `MAY` exists precisely for this situation, and the cost of
exercising it is one documented divergence instead of a broken integration.

### 14.4 The divergence, stated plainly

> SCIMServer treats `referenceTypes` as **documentation for the client**, not as a
> constraint on the server. It is published so that a well-behaved client knows
> what a reference points at; it is never used to reject anything. A client MUST
> NOT infer from a successful write that the reference target exists, is of the
> declared type, or is resolvable.

Anyone who later wants enforcement should read this section first, then
[section 13](#13-measured-what-these-rules-find-in-a-live-estate) for how to
measure the blast radius before switching it on.

---

## 15. Where SCIMServer stands today

**Status: P2 is now base behavior; the P1 gap is closable per endpoint, behind the `RfcCompliantSubAttributes` flag.**

This section originally recorded both divergences below as observations, with the
corrections listed as proposed follow-ups. Both have since shipped, but they
shipped **differently**, and the difference is the point:

- **P2 was a defect**, so it was fixed unconditionally. Strict validation
  honoured the `multiValued` characteristic at the attribute level and ignored it
  at the sub-attribute level, which meant it rejected payloads that conform to
  the schema the server itself publishes, and misreported a cardinality mismatch
  as a type error. A validator that misreads its own schema is not a policy
  choice. Shipped in **v0.55.7**.
- **P1 is a tightening**, so it stays behind the flag. An endpoint whose custom
  schema already declares a nested complex sub-attribute would start failing the
  moment it was enforced.

| | Flag OFF (default) | Flag ON |
|---|---|---|
| complex sub-attribute (forbidden by [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8)) | accepted | rejected `400 invalidValue` |
| multi-valued SIMPLE sub-attribute (allowed by [section 1.2](https://www.rfc-editor.org/rfc/rfc7643#section-1.2)) | **accepted, each element type-checked** | **accepted, each element type-checked** |

The second row no longer varies, which is what makes the flag comprehensible:
**everything it does rejects something.**

Measured blast radius of the P2 fix at the time it shipped (2026-08-18, dev
estate): **0** of **2,826** declared sub-attributes across 58 endpoints and 354
schemas carry `multiValued: true`, so no existing endpoint could change
behavior. The fix only widens what is accepted, so it cannot break a caller that
works today.

### 15.1 Planned evolution (NOT yet implemented)

> **Everything in this subsection is a design record, not shipped behavior.** As
> of v0.55.7 the server behaves exactly as the table above describes. Do not cite
> this subsection as documentation of a live feature.
>
> **Tracking lives elsewhere.** The status of every rule, the remaining items with
> their blocking conditions, and the sequencing are maintained in
> [SCIM_ATTRIBUTE_VALIDATION_CONFORMANCE_ROADMAP.md](../SCIM_ATTRIBUTE_VALIDATION_CONFORMANCE_ROADMAP.md).
> This section states the intent; that document tracks the work.

One change is planned, driven by the analysis in sections 12 to 14:

**`ON` grows from one rule to the full catalogue.** P1 today; P1 plus D1 to D11
(minus the document-only D7/D8, with D5 as a warning and D6 in its meaningful
form) under the plan. P2 is deliberately **not** in that list: as of v0.55.7 it
is base behavior of `StrictSchemaValidation` and is not gated on this flag at
all. Because the D-rules are schema rules, this adds a **second enforcement
point** at schema-write time, as diagrammed in
[section 12.4](#124-where-each-family-can-be-evaluated).

The measured blast radius is in [section 13.5](#135-what-the-measurement-implies):
across 108 live endpoints, exactly **one** would fail the stricter pass, and it
would fail on D11 because two of its attributes are named after filter
expressions.

The flag is also expected to be **renamed**, because `RfcCompliantSubAttributes`
describes only part of what it would govern - D1 and D4 to D11 are *attribute*
rules, not sub-attribute rules. At the time of writing the flag is set on **zero**
endpoints across all three live estates, so the rename costs nothing; it becomes
a breaking configuration change the moment anyone sets it.

### 15.2 How the shipped flag relates to this document

See [RFC_COMPLIANT_SUBATTRIBUTES.md](../RFC_COMPLIANT_SUBATTRIBUTES.md) for the
design, the 2x2 interaction with `StrictSchemaValidation`, and the test matrix.
Three details differ from the follow-up originally proposed here, and all three
were deliberate:

1. **It is enforced at payload-validation time, not schema-registration time.** A
   schema may still carry a legacy complex sub-attribute declaration; only a
   payload that populates it is refused. That keeps an existing endpoint's
   schema loadable after the flag is turned on. Note that
   [section 15.1](#151-planned-evolution-not-yet-implemented) proposes *adding*
   the schema-registration point rather than replacing this one, so both would
   apply.
2. **It is standalone, not gated on `StrictSchemaValidation`.** The two flags
   answer different questions - how carefully do I police this payload, versus
   is this schema shape legal at all - so a lenient endpoint must still be able
   to refuse a shape the RFC forbids.
3. **The flag governs P1 only.** P2 shipped as base behavior of
   `StrictSchemaValidation` instead, because it corrects a validator defect
   rather than expressing a policy. Bundling the two made the flag loosen and
   tighten at the same time, which is the one property that made it hard to
   describe in a sentence.

### 15.3 The original observation

`SchemaValidator.validateSingleValue` in [api/src/domain/validation/schema-validator.ts](../../api/src/domain/validation/schema-validator.ts) recurses into `subAttributes` with no depth cap:

```ts
// Recursively validate sub-attributes if defined
if (attrDef.subAttributes && attrDef.subAttributes.length > 0) {
  this.validateSubAttributes(
    path,
    value as Record<string, unknown>,
    attrDef.subAttributes,
    options,
    errors,
  );
}
```

`SchemaAttributeDefinition.subAttributes` in [api/src/domain/validation/validation-types.ts](../../api/src/domain/validation/validation-types.ts) is recursively typed, and there is no registration-time guard anywhere in `api/src/`. Consequences:

| Observation | Detail |
|---|---|
| Deep nesting is **accepted** (flag OFF) | An operator can register an endpoint schema with `type: "complex"` inside `subAttributes`; SCIMServer validates payloads against it and publishes it at `/Schemas`. With `RfcCompliantSubAttributes` ON, a payload populating that sub-attribute is refused. |
| The permissive behavior is **locked by a test** | [schema-validator-comprehensive.spec.ts](../../api/src/domain/validation/schema-validator-comprehensive.spec.ts) has a `deeply nested complex sub-attributes` describe block. It remains correct: it exercises the default, flag-off path. |
| Every shipped preset is **conformant** | [scim-schemas.constants.ts](../../api/src/modules/scim/discovery/scim-schemas.constants.ts) and [rfc-baseline.ts](../../api/src/modules/scim/endpoint-profile/rfc-baseline.ts) declare only simple sub-attributes. The gap is reachable only through operator-authored custom schemas, which is why the flag is opt-in. |
| Net | An RFC 7643 [section 2.3.8](https://www.rfc-editor.org/rfc/rfc7643#section-2.3.8) conformance gap that is latent by default and closable per endpoint: a schema SCIMServer happily serves may be one that no Entra or Okta client can PATCH. |

---

## 16. References

**Normative**

- RFC 7643, SCIM Core Schema - [info](https://www.rfc-editor.org/info/rfc7643) / [text](https://www.rfc-editor.org/rfc/rfc7643.txt) / [local mirror](rfc7643.txt)
- RFC 7644, SCIM Protocol - [info](https://www.rfc-editor.org/info/rfc7644) / [text](https://www.rfc-editor.org/rfc/rfc7644.txt) / [local mirror](rfc7644.txt)
- RFC 9865, Cursor-Based Pagination of SCIM Resources - [info](https://www.rfc-editor.org/info/rfc9865) / [local mirror](rfc9865.txt)
- RFC 9967, SCIM Profile for Security Event Tokens - [info](https://www.rfc-editor.org/info/rfc9967) / [local mirror](rfc9967.txt)
- RFC 7642, SCIM Definitions and Requirements - [info](https://www.rfc-editor.org/info/rfc7642) / [local mirror](rfc7642.txt)

**Errata**

- [RFC 7643 errata](https://www.rfc-editor.org/errata_search.php?rfc=7643) - 16 verified
- [RFC 7644 errata](https://www.rfc-editor.org/errata_search.php?rfc=7644) - 5 verified

**Vendor**

- [Microsoft Entra ID: develop a SCIM endpoint](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/use-scim-to-provision-users-and-groups)
- [Okta and SCIM Version 2.0](https://developer.okta.com/docs/api/openapi/okta-scim/guides/scim-20/)

**In this repository**

- [README.md](README.md) - the corpus, its provenance and its currency gate
- [RFC7643_SCHEMA_EXTRACT.md](RFC7643_SCHEMA_EXTRACT.md) - canonical JSON extracted from RFC 7643
- [RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md](../RFC7643_ATTRIBUTE_CHARACTERISTICS_FULL_AUDIT.md) - the 11 characteristics across every flow
- [CUSTOM_EXTENSIONS_RFC_GUIDE.md](../CUSTOM_EXTENSIONS_RFC_GUIDE.md) - authoring extension schemas
- [OPENTEXT_ISV3_SCHEMA_SOURCE_VS_LIVE.md](../OPENTEXT_ISV3_SCHEMA_SOURCE_VS_LIVE.md) - a real trimmed-sub-attribute interop failure
- [PATCH_OPERATIONS_COMPLETE_GUIDE.md](../PATCH_OPERATIONS_COMPLETE_GUIDE.md) - the path grammar in practice
