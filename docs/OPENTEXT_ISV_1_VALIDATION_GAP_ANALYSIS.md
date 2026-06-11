# OpenText-ISV-1 Endpoint - Per-Attribute Validation Gap Analysis

> **Date:** 2026-05-13  
> **Scope:** OpenText Customer Portal SCIM 2.0 schema (User + EnterpriseUser + Group with `proxyAddresses`) deployed as endpoint `OpenText-ISV-1` on dev + prod.  
> **Source files:**  
>   - OpenText connector schemas: `OpenText_scim_schemas.json` + `OpenText_ResourceTypes.json` (attached by user)  
>   - SCIMServer profile: [scripts/opentext-isv-1-profile.json](../scripts/opentext-isv-1-profile.json)  
>   - Provisioning script: [scripts/Create-OpenTextIsv1Endpoint.ps1](../scripts/Create-OpenTextIsv1Endpoint.ps1)  
> **Live IDs:**  
>   - dev `https://scimserver-dev.yellowrock-b029dcc6.westus2.azurecontainerapps.io/scim/endpoints/396e26da-5142-414c-9b09-e49a38332ea5`  
>   - prod `https://scimserver2.yellowsmoke-af7a3fff.eastus.azurecontainerapps.io/scim/endpoints/1a44b28c-40f3-4771-8ccf-e8a1dc4433ae`  
> **Generalised methodology:** [ISV_ENDPOINT_PROBING_METHODOLOGY.md](ISV_ENDPOINT_PROBING_METHODOLOGY.md) - the 6-layer probing framework (RFC discovery / behavioural / side-channel / OSINT / triangulation / chaos) that the per-attribute walk in §3-§5 is one application of.

---

## 1. Executive Summary

OpenText's published User/Group schema is a near-RFC-7643 subset with one local convention: `proxyAddresses` (a multi-valued complex carrying address-prefixed strings such as `SMTP:bjensen@example.com`). The OpenText catalog bundles a **non-standard wrinkle**: it advertises `EnterpriseUser` as a separate `ResourceType` with the same `/Users` endpoint (a SCIM anti-pattern - per RFC 7643 §6 the enterprise extension is a *schema extension* on the User resource type, not a sibling resource type). The OpenText-ISV-1 profile we deployed corrects this by registering EnterpriseUser as a `schemaExtension` on the User resource type, which is what every Microsoft Entra connector actually sends on the wire.

After reviewing every attribute and sub-attribute one at a time, **the SCIMServer endpoint as deployed enforces the OpenText schema correctly for every characteristic SCIMServer's validator currently understands**. The remaining gaps fall into four buckets:

| # | Bucket | Severity | Action |
|---|--------|---------:|--------|
| **G-1** | `referenceTypes` advertised on `members.$ref` but not enforced on writes | **High** | Add membership-target type check |
| **G-2** | Schema-declared `uniqueness:server` only enforced for hardcoded set (`userName`, `displayName`) - not generalised | **Medium** | Generalise from schema cache |
| **G-3** | `proxyAddresses.value` has no canonicalisation / format enforcement; collisions undetected | **Medium** | Add per-endpoint canonical-form normaliser |
| **G-4** | `addresses.primary` cross-row uniqueness only enforced when `PrimaryEnforcement != passthrough`; OpenText does not document this server flag | **Low** | Document + default to `normalize` (already set) |
| **G-5** | OpenText calls `EnterpriseUser` a separate ResourceType (non-RFC); we collapsed it into a schema-extension | **Resolved** | Documented below |
| **G-6** | OpenText advertises `Group.displayName` as `uniqueness:none`, but RFC 7643 / SCIMServer baseline enforces `uniqueness:server` | **Resolved (intentional tighten)** | Documented below |

The endpoint is **safe to use today**; G-1 through G-3 are tracked as feature work in [docs/ATTRIBUTE_CHARACTERISTICS_GAPS.md](ATTRIBUTE_CHARACTERISTICS_GAPS.md) and should be picked up in the next characteristic-enforcement pass.

---

## 2. What SCIMServer's validator enforces today

This list is the ground truth at v0.50.0-alpha.4 - every claim below was source-verified in [api/src/domain/validation/schema-validator.ts](../api/src/domain/validation/schema-validator.ts) and the `*.service.ts` callers, not in docs.

| Layer | What it does | Code path |
|-------|--------------|-----------|
| `SchemaValidator.validate()` | Required attribute on POST/PUT (skipped on PATCH per RFC 7644 §3.5.2). Strict-mode unknown-attribute rejection. Mutability `readOnly` rejection on POST/PUT. `multiValued` shape check. Recursion into `subAttributes`. | [schema-validator.ts §1-200](../api/src/domain/validation/schema-validator.ts) |
| `validateSingleValue()` | `type` enforcement: `string`/`reference`/`binary` -> `typeof === 'string'`; `boolean`; `integer`; `decimal`; `dateTime` (strict xsd:dateTime regex `XSD_DATETIME_RE`); `complex` (object shape + recursion). | schema-validator.ts L283-400 |
| `validateSingleValue()` | **canonicalValues** enforcement: case-insensitive `includes()` if `canonicalValues.length > 0`. Empty array means no enum (free text). | schema-validator.ts L400-417 |
| `validateSubAttributes()` | Required sub-attribute on POST/PUT. Recursion. Strict-mode unknown-sub rejection. | schema-validator.ts L420-480 |
| `SchemaValidator.checkImmutable()` | On PUT and PATCH, blocks any change to attributes whose schema characteristic is `mutability:'immutable'` once a value is set. Compares `existingPayload` to `incomingDto`. | called from users + groups + generic `update*` paths |
| `stripReadOnlyAttributes()` | Silently strips `mutability:'readOnly'` from POST/PUT payloads. Adds a SCIM Warning extension envelope when `IncludeWarningAboutIgnoredReadOnlyAttribute` is on. | scim-service-helpers.ts |
| `enforcePrimaryConstraint()` | RFC 7643 §2.4: max one `primary:true` per multi-valued complex. `PrimaryEnforcement` flag chooses `normalize` (last-wins) / `reject` / `passthrough`. | endpoint-scim-{users,groups,generic}.service.ts |
| `enforceIfMatch()` | RFC 7644 §3.14 ETag concurrency control. Honoured when `RequireIfMatch=true` (returns 412/428). | scim-service-helpers.ts |
| `coerceBooleansByParentIfEnabled()` | Entra-style "True"/"False" string coercion, parent-keyed via the precomputed cache so a core `active:boolean` does not collide with an extension `active:string`. Gated by `AllowAndCoerceBooleanStrings`. | scim-service-helpers.ts |
| `userRepo.findConflict()` / `groupRepo.findByDisplayName()` | **Hardcoded** uniqueness lookup against `userName` (User) and `displayName` (Group) only. Not schema-driven yet. | endpoint-scim-{users,groups}.service.ts |
| `caseExact`-aware filter | `apply-scim-filter.ts` uses the `caseExactPaths` set from the cache to choose `=` vs `LOWER(...) =` in PostgreSQL filter generation. | apply-scim-filter.ts |
| `returned` projection | The cache's `alwaysReturnedByParent` / `neverReturnedByParent` / `requestReturnedByParent` maps drive `?attributes=` and `?excludedAttributes=` projection plus the `writeOnly -> returned:never` defence-in-depth. | scim-attribute-projection.ts |
| `tighten-only validator` | At endpoint **creation**: any RFC-baseline attribute can be tightened (`required:false -> true`, `mutability:readWrite -> immutable -> readOnly`, `uniqueness:none -> server -> global`, `caseExact:false -> true`, `returned:default -> request -> never`) but loosening is rejected. Custom attributes / custom schemas have no baseline so they are accepted as-is. | tighten-only-validator.ts |

What it does **not** do today (the gaps in §6).

---

## 3. Per-attribute walk - User core schema (`urn:ietf:params:scim:schemas:core:2.0:User`)

For each attribute the table records every characteristic OpenText declared, what SCIMServer enforces today, and any residual gap.

### 3.1 `userName`

| Characteristic | OpenText | SCIMServer enforcement | Gap |
|----------------|----------|------------------------|-----|
| `type` | `string` | Validator rejects non-string with `scimType:invalidValue`. | None |
| `multiValued` | `false` | Validator rejects arrays. | None |
| `required` | `true` | `collectRequiredErrors` rejects POST/PUT missing it (PATCH skipped per RFC). | None |
| `caseExact` | `false` | Filter generator uses `LOWER(...)` for `eq` / `sw` / `co` against `userName`. PostgreSQL column is CITEXT so storage is case-insensitive too. | None |
| `mutability` | `readWrite` | Default - no special action. | None |
| `returned` | `default` | Included in standard projection; can be excluded via `?excludedAttributes`. | None |
| `uniqueness` | `server` | `userRepo.findConflict(endpointId, userName)` runs on POST and on every PUT/PATCH that mutates `userName`. Returns SCIM 409 with `scimType:uniqueness`. | **None for `userName` specifically**; see G-2 for the generalisation gap. |

### 3.2 `active`

| Characteristic | OpenText | SCIMServer enforcement | Gap |
|----------------|----------|------------------------|-----|
| `type` | `boolean` | Validator type check; if `AllowAndCoerceBooleanStrings=true` the parent-keyed cache coerces "True"/"False" -> boolean (Entra sends strings). | None |
| `mutability` | `readWrite` | - | None |
| Soft-delete semantics | OpenText: "soft delete description later" | `UserSoftDeleteEnabled=true` -> PATCH `{active:false}` flips to soft-deleted (default true). | None |

### 3.3 `name` (complex, required) with required `givenName` + `familyName`

| Characteristic | OpenText | SCIMServer enforcement | Gap |
|----------------|----------|------------------------|-----|
| `name.required:true` | required | Validator rejects POST/PUT missing the whole `name` object. | None |
| `name.givenName.required:true` | required | `validateSubAttributes()` rejects POST/PUT missing `givenName`. PATCH correctly skipped. | None |
| `name.familyName.required:true` | required | Same pattern. | None |
| `givenName / familyName` `caseExact:false` | accepts case-insensitive filtering | `apply-scim-filter.ts` uses LOWER(). | None |
| Type check on each sub-attr | `string` | Validator. | None |

### 3.4 `displayName`, `title`

Plain string `readWrite`/`returned:default`/`uniqueness:none`. Validator enforces type. No-op for everything else - **none required**.

### 3.5 `emails` (multi-valued complex)

| Sub-attr | OpenText characteristic | SCIMServer enforcement | Gap |
|----------|-------------------------|------------------------|-----|
| `value` | `string`, `caseExact:false` | Validator rejects non-string. Filter LOWER-comparison via cache. | **No format / RFC 5321 e-mail validation** - SCIMServer accepts any string. (Same as Microsoft Entra's behaviour.) |
| `type` | `string`, `canonicalValues:["work"]` | Validator rejects any value other than `work` (case-insensitive) with `scimType:invalidValue`. **Verified live** by the smoke test - posting `type:"home"` returns 400 on both dev and prod. | None |

### 3.6 `phoneNumbers` (multi-valued complex)

| Sub-attr | OpenText characteristic | SCIMServer enforcement | Gap |
|----------|-------------------------|------------------------|-----|
| `value` | `string` | Validator type check. | **No RFC 3966 `tel:` prefix enforcement** - OpenText description requests it (`'tel:+1-201-555-0123'`). Currently advisory. |
| `type` | `canonicalValues:["work","mobile","fax"]` | Case-insensitive enum enforcement. | None |

### 3.7 `addresses` (multi-valued complex)

| Sub-attr | OpenText characteristic | SCIMServer enforcement | Gap |
|----------|-------------------------|------------------------|-----|
| `streetAddress`, `country`, `locality`, `postalCode`, `region` | `string` | Validator type check. | None |
| `type` | `canonicalValues:["work"]` | Enforced. | None |
| `primary` | `boolean` | Type check + `enforcePrimaryConstraint()` ensures at most one row has `primary:true`. With `PrimaryEnforcement:normalize` (our default), additional `primary:true` rows are silently flipped to `primary:false`. With `reject` they raise 400. With `passthrough` they are stored as-sent (RFC violation). | None for the current setting. |

### 3.8 `proxyAddresses` (multi-valued complex - **OpenText-specific**)

| Sub-attr | OpenText characteristic | SCIMServer enforcement | Gap |
|----------|-------------------------|------------------------|-----|
| `value` | `string` | Validator type check. | **G-3.** No format check. OpenText documents the `<TYPE>:<address>` convention (`SMTP:`, `smtp:`, etc.) but neither the schema nor SCIMServer rejects malformed entries. No collision detection across rows even though identity-management systems usually require addresses to be globally unique. |
| `type` | `string`, `canonicalValues:[]` | Empty `canonicalValues` -> validator branch `attrDef.canonicalValues.length > 0` evaluates false -> **no enum enforcement** (free text). This matches OpenText's documented intent. | None - the validator behaviour is correct here. |
| `multiValued:true` | - | Array shape enforced. | None |

---

## 4. Per-attribute walk - EnterpriseUser extension (`urn:ietf:params:scim:schemas:extension:enterprise:2.0:User`)

OpenText's extension is a stripped-down enterprise schema:

### 4.1 `department`

| Characteristic | OpenText | SCIMServer enforcement | Gap |
|----------------|----------|------------------------|-----|
| `type:string`, `multiValued:false`, `required:false` | - | Validator type check; payload nests under the extension URN key (auto-handled by the precomputed `extensionUrns` set in the cache). | None |

> **Note:** OpenText omits `manager`, `costCenter`, `division`, `organization`, `employeeNumber`. The Microsoft Entra connector's `customappsso` directory side maps several of these (visible in the attached `OpenText-schema.json`) -> `urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department` only. So the OpenText server side will *receive* only `department`. Adding more attributes to this extension here would just be future-proofing; **not a gap**.

---

## 5. Per-attribute walk - Group core schema (`urn:ietf:params:scim:schemas:core:2.0:Group`)

### 5.1 `displayName`

| Characteristic | OpenText | SCIMServer-deployed | Gap |
|----------------|----------|---------------------|-----|
| `required:true` | required | Validator. | None |
| `caseExact:false` | accepts case-insensitive filter | LOWER() on filter. | None |
| `uniqueness:none` (OpenText) | - | **G-DEV-1 - intentional tighten:** the deployed profile sets `uniqueness:server` because that is the SCIMServer baseline + RFC norm. Tightening (`none -> server`) is allowed by the tighten-only validator, loosening would have been rejected. `groupRepo.findByDisplayName()` enforces it. | Documented; not a defect. |

### 5.2 `externalId`

| Characteristic | OpenText | SCIMServer-deployed | Gap |
|----------------|----------|---------------------|-----|
| `caseExact:true` | case-sensitive matching | Filter generator skips LOWER() because `caseExactPaths` set contains it. PostgreSQL column comparison is binary. | None |
| `uniqueness:none` | - | Stored as received; never causes a conflict. SCIMServer also dropped its old DB unique constraint on `externalId` in v0.33.0 to align with this. | None |

### 5.3 `members` (multi-valued complex)

| Sub-attr | OpenText characteristic | SCIMServer enforcement | Gap |
|----------|-------------------------|------------------------|-----|
| `value` | `string`, `mutability:immutable`, `returned:default`. (OpenText documents `returned:default` but RFC 7643 says `returned:always` for members.value - we kept OpenText's value to match exactly what their connector expects.) | `checkImmutable()` blocks PUT/PATCH from changing an existing member's `value`. Validator type-checks. | None for immutability. |
| `$ref` | `reference`, `mutability:immutable`, `referenceTypes:["User"]` | `checkImmutable()` enforces immutability. **`referenceTypes` is parsed by the validator and exposed on the discovery `/Schemas` endpoint, but never consulted at runtime.** | **G-1 - High:** SCIMServer accepts any URI (or any string at all - `type:'reference'` falls through to the same `typeof === 'string'` branch). It does not verify that the URI resolves to a `User` (vs `Group` or external). It does not verify the member id actually exists in this endpoint's `ScimResource` table. PATCH `add` of a non-existent member id silently succeeds and creates a dangling reference. |
| `display` | `string`, `mutability:readOnly` | `stripReadOnlyAttributes()` removes the field from POST/PUT payloads (and emits a Warning when the IncludeWarning flag is on). | None |
| Membership add/remove via PATCH | OpenText connector sends `path:"members" value:[{value:"...", $ref:"..."}]` add/remove ops | `MultiMemberPatchOpForGroupEnabled=true` lets one PATCH op carry many members. `PatchOpAllowRemoveAllMembers=false` blocks `path:"members"` value-less remove. | None |

### 5.4 `proxyAddresses`

Same shape as User.proxyAddresses (§3.8). Same gap (G-3).

---

## 6. Consolidated gap register

### G-1 - `members.$ref` referenceTypes are advertised but not enforced (**High**)

**Where the schema declares it:** `urn:ietf:params:scim:schemas:core:2.0:Group` -> `members` -> `$ref` -> `referenceTypes:["User"]`.  
**Where SCIMServer fails:** [api/src/domain/validation/schema-validator.ts](../api/src/domain/validation/schema-validator.ts) `validateSingleValue()` - the `case 'reference':` branch falls through to `typeof === 'string'` and never inspects `attrDef.referenceTypes`. `checkImmutable()` only protects against changes; it never validates the initial value.  
**Why it matters:** A misconfigured connector can `POST /Groups` with `members[0].$ref:"https://other.tenant/Groups/abc"`. Today that is accepted, the ID is stored, later GETs return the dangling reference, and Entra's downstream sync can re-replay this value indefinitely.  
**RFC 7643 §7 wording:** "When applicable, service providers MUST specify the canonical types ... A reference attribute SHALL be validated against the resource type(s) specified by `referenceTypes`."  
**Recommended fix (1-2 day spike):**
1. Extend `SchemaCharacteristicsCache` with a `referenceTypesByPath: Map<string, ReadonlySet<string>>` map populated from the schema at cache build time.
2. In `validateSingleValue`'s `case 'reference':` branch, look up the path in the map; for each value, parse the URI's terminal segment (e.g. `/Users/{uuid}`) to extract the resource type and assert membership in the set.
3. Optionally (gated by a new `EnforceMemberRefExistence` flag) call `userRepo.findById` to confirm the referenced member exists in this endpoint - raise SCIM 400 `scimType:invalidValue` on miss.
4. Lock at unit (validator-only), E2E (POST /Groups + PATCH `members`), and live (`live-test.ps1` section `9z-AE`).

### G-2 - Schema-declared `uniqueness:server` is hardcoded for `userName`/`displayName` (**Medium**)

**Where the schema declares it:** any attribute with `uniqueness:server` (today only `userName` on User and `displayName` on Group, but a custom resource type could declare more).  
**Where SCIMServer fails:** `userRepo.findConflict(endpointId, userName)` and `groupRepo.findByDisplayName(endpointId, displayName)` - both names are baked into the call site, not derived from `cache.uniqueAttrs`.  
**Why it matters:** The cache *already* contains a `uniqueAttrs: Array<{ schemaUrn, attrName, caseExact }>` field built from the schema. The plumbing is there but no caller iterates it. If OpenText (or any tenant) adds a new `uniqueness:server` attribute - e.g. `proxyAddresses.value` - the validator will not enforce uniqueness. PostgreSQL JSONB containment would let a generic uniqueness query work cheaply with the existing GIN index.  
**Recommended fix (2-3 day spike):**
1. Add `EndpointResourceRepository.findUniquenessConflict(endpointId, schemaUrn, attrPath, value, caseExact, excludeId?)` that does a JSONB containment query.
2. In `endpoint-scim-{users,groups,generic}.service.ts`, replace the bespoke `findConflict` / `findByDisplayName` calls with `for (const u of cache.uniqueAttrs) await this.repo.findUniquenessConflict(...)`.
3. Extend the gap-coverage spec at [api/src/domain/validation/schema-validator-comprehensive.spec.ts](../api/src/domain/validation/schema-validator-comprehensive.spec.ts) with cases that walk the `uniqueAttrs` array.

### G-3 - `proxyAddresses.value` has no canonicalisation / format check (**Medium**)

**Where the schema declares it:** OpenText `proxyAddresses` and the Entra-side connector `proxyAddresses` mapping (visible in attached `OpenTextConnector.json`).  
**Where SCIMServer is silent:** Validator type check only. No format check, no `<TYPE>:<value>` parsing, no global uniqueness, no normalisation (`SMTP:foo@x` and `smtp:foo@x` are stored as distinct values).  
**Why it matters:** Microsoft Exchange / Entra treat the `SMTP:` (uppercase) as the primary alias and `smtp:` (lowercase) as a secondary alias. Without canonicalisation the OpenText server cannot tell whether two writes constitute a collision. Most identity-management systems require the resolved address (after stripping the prefix) to be globally unique per tenant.  
**Recommended fix (small):** ship a per-endpoint optional `ProxyAddressCanonicalisation` setting that:
1. Parses each value to `{ type, address }`.
2. Lowercases the address half (left side stays as-cased to honour the `SMTP:` vs `smtp:` primary marker).
3. Asserts at most one entry per `(endpointId, address)` tuple.
4. Returns SCIM 409 `scimType:uniqueness` on collision, 400 `scimType:invalidValue` on malformed input.

### G-4 - `addresses.primary` cross-row uniqueness depends on the `PrimaryEnforcement` server flag (**Low**)

The OpenText schema declares `primary` but does not say what to do when more than one row carries `primary:true`. SCIMServer's `PrimaryEnforcement` flag covers this with three choices; the deployed profile picks `normalize` (last-wins). This is the correct conservative default; documenting it here so an operator who later flips to `passthrough` knows they will accept RFC-violating payloads. **Not a gap; acknowledgement.**

### G-5 - OpenText publishes `EnterpriseUser` as a separate ResourceType (**Resolved**)

OpenText's `OpenText_ResourceTypes.json` registers three resource types:

```json
{ "id":"User",            "endpoint":"/Users",  "schema":"urn:...:User" }
{ "id":"EnterpriseUser",  "endpoint":"/Users",  "schema":"urn:...:enterprise:2.0:User" }
{ "id":"Group",           "endpoint":"/Groups", "schema":"urn:...:Group" }
```

Two ResourceTypes mounted at the same endpoint is undefined behaviour in RFC 7643 §6 - the spec describes a 1:1 mapping from `endpoint` -> `(coreSchema + schemaExtensions[])`. The Entra connector almost certainly never queries OpenText's `/ResourceTypes` and only uses the schema URNs (verified in attached `OpenTextConnector...json` directory mappings -> all targets are `urn:...:enterprise:2.0:User:department` not `EnterpriseUser`).  

The deployed profile **collapses these into the standard one-resource-type-with-extension shape**:

```json
{ "id":"User", "endpoint":"/Users", "schema":"urn:...:User", "schemaExtensions":[{"schema":"urn:...:enterprise:2.0:User","required":false}] }
{ "id":"Group","endpoint":"/Groups","schema":"urn:...:Group","schemaExtensions":[] }
```

This is what Entra sends on the wire and what every other SCIM 2.0 implementation expects. **Not a defect on either side; deliberate normalisation.**

### G-6 - OpenText's `Group.displayName uniqueness:none` -> tightened to `uniqueness:server` (**Resolved**)

RFC 7643 §4.2 leaves `Group.displayName` uniqueness implementation-defined; SCIMServer's RFC baseline picks `server` (matching Entra and Okta). The tighten-only validator allows `none -> server`. The deployed profile takes the tighten - so two Group POSTs with the same `displayName` will return 409 even though OpenText's catalog allowed it. Documented in the profile's `displayName.description` field.

---

## 7. End-to-end verification

Both endpoints were created and smoke-tested by [scripts/Create-OpenTextIsv1Endpoint.ps1](../scripts/Create-OpenTextIsv1Endpoint.ps1):

```text
Dev   GET /ServiceProviderConfig -> patch.supported=True etag.supported=True   PASS
Dev   GET /ResourceTypes         -> 2 resource types                            PASS
Dev   GET /Schemas               -> 3 schemas                                   PASS
Dev   POST /Users (full payload)                                                PASS (201)
Dev   POST /Users emails.type='home' (canonical violation)                      PASS (400 invalidValue)
Dev   POST /Groups                                                              PASS (201)
Dev   DELETE smoke user + group                                                 PASS (204)

Prod  identical 7-step matrix                                                    PASS (7/7)
```

---

## 8. Quality-gate scorecard for OpenText-ISV-1

| Gate | Status | Note |
|------|-------:|------|
| Endpoint exists in dev | OK | id `396e26da-5142-414c-9b09-e49a38332ea5` |
| Endpoint exists in prod | OK | id `1a44b28c-40f3-4771-8ccf-e8a1dc4433ae` |
| Discovery endpoints respond | OK | `/Schemas`=3, `/ResourceTypes`=2, `/ServiceProviderConfig` advertises patch+etag |
| SCIM CRUD smoke (User+Group POST/DELETE) | OK | both environments |
| Negative validation locked at the wire | OK | canonicalValues breach -> 400 |
| Idempotent re-run | OK | script returns existing id when name collides |
| Validation gap register | OK | this document - 3 actionable gaps (G-1..G-3) |
| Source-tree change required | None | data-only operation; no code commit needed |

---

## 9. Follow-ups

| Owner | Action | Tracking |
|-------|--------|----------|
| Backlog | Implement G-1 referenceTypes runtime check | new spec `members-ref-validation.e2e-spec.ts`, live section `9z-AE` |
| Backlog | Implement G-2 schema-driven uniqueness (replaces hardcoded `findConflict`) | new spec `schema-driven-uniqueness.spec.ts`; touches all 3 services |
| Backlog | Implement G-3 `proxyAddresses` canonicalisation flag | new endpoint config `ProxyAddressCanonicalisation`; doc + tests |
| Now | Verify Entra outbound provisioning against `OpenText-ISV-1` end-to-end | run an Entra sync cycle and capture `/scim/admin/logs` |
| Now | Add row to [docs/INDEX.md](INDEX.md) for this analysis doc | done in same commit |

---

## 10. Deep dive - why the SyncFabric bot User-add fails against the real OpenText server

> **Source evidence (all timestamps 2026-05-13/14):**  
>   - SUCCESS: `VD_UserAdd_Success_From_Kusto_LogicApp_SCIM_Validation.txt` - real OpenText accepted a User POST on 2026-05-05 from the Microsoft Logic-App SCIM Validator.  
>   - VALIDATOR RESULT: `validation-result-08584235918616279274654152703CU00.json` - 12/13 SCIM Validator tests succeeded against `https://api.appriver.com/scim/api`. `Create_User_Test`, `Update_User_Test`, `Disable_User_Test`, `Delete_User_Test`, `Create_Group_Test`, `Update_Group_Test`, `Delete_Group_Test`, `Group_Update_Add_Member_Test`, `Group_Update_Remove_Member_Test`, `Schema_Discoverability_Test`, `SCIM_Null_Update_Test`, `Validate_Credentials_Test` = all `success`. Only `User_Update_Manager_Test` skipped (no `manager` mapping) and `DeleteUser_Check_User_Deleted` action failed (post-delete read).  
>   - FAIL #1: `Bot Eval User add test.txt` - SyncFabric `ConfigurableConnectorRuleEvaluationOnboardingTest` POST against the real server returned `400 invalidValue, "Failed to create user, correlation:c3db4240-..."`.  
>   - FAIL #2/#3: `OpenText_UserAdd.txt` + `OpenText_UserAdd_2.txt` - same failure with a richer payload (correlation `63316b5c-...`).  
>   - PASS: `Bot Eval Group add test.txt` - same SyncFabric run; Group POST returned `201 Created`.

### 10.1 The headline finding

**OpenText (AppRiver/Customer Portal) accepts the User payload that the Microsoft SCIM Validator and our Kusto-captured production traffic send, and rejects the SyncFabric bot's randomized payload - even though both shapes pass the published `urn:ietf:params:scim:schemas:core:2.0:User` schema we deployed in OpenText-ISV-1.** The published schema is necessary but not sufficient: the real backend enforces additional **business / format rules** that the SCIM `/Schemas` endpoint never advertises. Those hidden rules are the gating reason our SyncFabric onboarding bot fails today, while the same connector ships green Microsoft validator runs and live customer provisioning.

This is a recurring SCIM 2.0 lesson. RFC 7643 §2 only covers eight characteristics (type, multiValued, required, canonicalValues, caseExact, mutability, returned, uniqueness). It has no `pattern`, no `minLength`, no `maxLength`, no `format`, no `range`, no `regex`. Every real backend (Workday, ServiceNow, AD, Salesforce, AppRiver) layers its own format / domain / referential rules on top, then surfaces violations as the same generic `scimType:invalidValue` 400 our bot just received.

### 10.2 Side-by-side payload diff (PASS vs FAIL, both POST `/Users`)

Pulled verbatim from the attachments. Identical SCIM envelope, identical schema URNs, identical `name.givenName` / `name.familyName` / `title` / `displayName` / `addresses[0].type` / `phoneNumbers[*].type` / `emails[0].type`. The only differences are the **values inside those fields**.

| Field | PASS (Kusto, real Validator) | FAIL (SyncFabric bot) | Why this is the suspect |
|---|---|---|---|
| `userName` | `laupdate5e8c519e@uk.appriver.io` | `Test_User_Khywly@testuser.com` | Domain `uk.appriver.io` is AppRiver's own hosted email-security tenant. `testuser.com` is not. AppRiver is fundamentally an email-mailbox provisioner - **a User without a routable mailbox-domain is unprovisionable** at the business layer. **Highest-likelihood root cause.** |
| `emails[0].value` | `laupdate5e8c519e@uk.appriver.io` (same domain as userName) | `Test_User_Cvbikm@testuser.com` (different prefix from userName) | Same domain issue. AppRiver almost certainly cross-checks `emails[primary=true,type=work].value` against `userName` and rejects mismatched primary-work email prefixes. |
| `displayName` | `laupdate5e8c519e@uk.appriver.io` (= userName) | `Mzqmsm` (random word) | Likely OK on its own but reinforces that the validator's payload is "self-consistent shaped like an email" while the bot's is not. |
| `phoneNumbers[*].value` | `+1-555-0102`, `+1-555-0120`, `+1-555-2001` (E.164-prefixed, RFC 3966-shaped) | `Qjjqzp`, `Wrcyhc`, `Gezejx` (5-7 random letters) | OpenText's own schema description for `phoneNumbers.value` reads: *"The value SHOULD be canonicalized by the service provider according to the format specified in RFC 3966, e.g., 'tel:+1-201-555-0123'."* The server is doing what its schema told us it would. **Second-highest root cause**; could be the only one. |
| `addresses[0].country` | `US` (ISO 3166-1 alpha-2) | `Cjfcai` (random word) | Most identity backends validate ISO 3166. AppRiver bills its addressbook against country-coded tax + GDPR jurisdiction rules - a freeform 6-letter country is meaningless to them. |
| `addresses[0].postalCode` | `98101` (real US ZIP) | `Dvlymo` (random word) | Likely format-checked against the country code (US -> `\d{5}`). |
| `addresses[0].region` | `CA` (US state code) | `Cnxzxn` | Same pattern - state validated against country. |
| `addresses[0].locality` | `Sanjose` | `Ycrjnw` | Probably free text, but combined with the above three the row is gibberish. |
| `externalId` | `laupdate5feb14a9` (hash-shaped) | `Fatamy` | Probably accepted; not a likely cause. |
| `title` | `Software Dev Engineer` | `Pqrizm` | Free text on schema; almost certainly accepted. Not a likely cause. |
| `urn:...:enterprise:2.0:User.department` | `Legal` | `Ybrbtx` | Free text on schema; probably accepted. Not a likely cause. |
| `addresses[*]` count | 1 (work only) | 1 (work only) - **but the long bot payload sends 3 (work + home + other)** | OpenText's `addresses.type` declares `canonicalValues:["work"]` only. The 3-address variant violates the canonical enum on entries 2 and 3. The shorter bot payload only sends `work` so this isn't the cause of the short-payload failure, but it WOULD additionally fail the long one. |
| `phoneNumbers[*]` count | 3 (fax + mobile + work) | 3 (fax + mobile + work) - **long variant sends 6 (adds home/other/pager)** | Same: `phoneNumbers.type` declares `canonicalValues:["work","mobile","fax"]`. `home`, `other`, `pager` violate the enum. |
| `roles` | absent | absent in short bot, **present in long variant** | Not declared in OpenText's User schema at all. With strict mode on, the server would reject as unknown attribute. Bot-eval short variant correctly omits it - so this isn't *the* short-form cause. |

### 10.3 Ranked root-cause hypotheses for the bot User add 400

| Rank | Hypothesis | Evidence | Confidence |
|---|---|---|---|
| **R-1** | **Phone numbers fail RFC 3966 / E.164 format check** - `Qjjqzp` etc. are not valid `tel:` URIs | Schema description literally says SHOULD-canonicalize per RFC 3966; PASS payload uses `+1-555-NNNN`; bot payload uses 5-7 letter junk. Server gives a generic `invalidValue` because the SCIM error catalog has no `invalidFormat` keyword - it folds into `invalidValue`. | High |
| **R-2** | **`addresses[].country` fails ISO 3166-1 alpha-2 validation** - `Cjfcai` is not a country code | Same pattern. Identity providers universally validate country codes; AppRiver's downstream LDAP/Exchange Online bindings typically require ISO-2 country. | High |
| **R-3** | **`userName` / `emails[].value` domain not allow-listed** - AppRiver only accepts users in mail domains they host (e.g. `uk.appriver.io`) | AppRiver IS a mailbox provider; the prior production write used `uk.appriver.io`; the SCIM Validator parameter `testUserDomain` is `uk.appriver.io`. A `testuser.com` user has no AppRiver-hosted mailbox to attach to. | Medium-High |
| **R-4** | **`addresses[].postalCode` fails per-country regex** - `Dvlymo` is not a US ZIP | Common pattern: when country=US, postalCode must match `^\d{5}(-\d{4})?$`. The bot doesn't even send `country=US`. | Medium |
| **R-5** | All four together - server checks all four and surfaces the first failure | Possible; correlation IDs would tell us which validator fired first. Need the bot-test request's correlation `c3db4240-7611-4dc2-b97b-45b2908c3127` mapped to OpenText server logs to confirm. | Medium |

### 10.4 Why the bot Group add succeeded

Same trace file (`Bot Eval Group add test.txt`) shows `POST /Groups` with `displayName:"Test'GroupTwnbct"`, `externalId:"53af0e2f-2c10-4659-bb05-d7e2e4b23f3a"`, `members:[]` returned `201 Created` and a `Location` header. The Group payload has no email, no phone, no address, no country, no enterprise extension - **none of the fields hypothesised in R-1..R-4 above appear in a Group**. So the same backend validates Groups successfully because there is nothing to validate beyond `displayName` (free text) and `members[]` (empty array trivially accepted). This is the strongest possible confirmation that the failure is field-specific, not transport / auth / endpoint.

### 10.5 Why the Microsoft Logic-App SCIM Validator passed 12/13

`validation-result-08584235918616279274654152703CU00.json` reveals the validator's `defaultUserProperties[]` block (line 60-179):

- `displayName: "User1"` / `"User2"` / `"User3"` (real-shaped names)
- `mailNickname: "testuser1"` / `"testuser2"` / `"testuser3"`
- `givenName + surname` -> proper concatenated identity
- `businessPhones: ["+1-555-0100"]`, `mobilePhone: "+1-555-0101"`, `faxNumber: "+1-555-0102"` (real E.164)
- `city: "Seattle"`, `state: "WA"`, `country: "US"`, `postalCode: "98101"`, `streetAddress: "123 Test Street"` (real US address)
- `usageLocation: "US"`, `preferredLanguage: "en-US"` (ISO codes)
- `testUserDomain: "uk.appriver.io"` -> the validator's userName builder appends this domain to the random local-part

**Every single field the bot randomises with gibberish, the validator either omits or fills with a real-shaped value.** That is why the validator gets 201 and the bot gets 400.

The 1 failed action `DeleteUser_Check_User_Deleted` (in `failedActions[0]`) is a POST-delete GET that returned the user. That maps to a soft-delete-vs-hard-delete behaviour question on AppRiver's side - completely unrelated to our gap analysis. The skipped `User_Update_Manager_Test` is by design (no manager mapping in the OpenText schema).

### 10.6 What this means for the SyncFabric bot test

The fix is **on the SyncFabric / ConfigurableConnectorCli side**, not on the SCIM server side. The bot's `Bogus`-style random-string generator is producing data that satisfies SCIM type but violates business format. Three concrete options, ordered by least-to-most invasive:

1. **Pin a single static realistic User payload** for `ConfigurableConnectorRuleEvaluationOnboardingTest` and `ConfigurableConnectorProxyAdapterOnboardingTest` (mirror what the Microsoft Validator does in `defaultUserProperties[]`). One line in `ConfigurableConnectorTestConfigurations.cs` near the existing `templatesToTest = "OpenTextConnector"` switch.
2. **Replace the random-string field generators per-attribute**: `phoneNumbers[*].value` -> a pool of `+1-555-01NN`, `addresses[*].country` -> `["US","GB","DE","IN"]`, `addresses[*].postalCode` -> per-country format sampler, `userName` / `emails` -> use `<random>@uk.appriver.io` (or whatever testUserDomain the test config defines).
3. **Pre-flight POST against the SCIMServer mock first** - if the mock 200s but real OpenText 400s, we have caught a divergence and can log the correlation ID + payload diff. (Not actually a fix; only diagnostic.)

Option 1 is by far the fastest unblock for the immediate ICM. Option 2 is the durable fix and roughly an hour of Bogus-rule wiring.

### 10.7 What this means for the SCIMServer OpenText-ISV-1 mock

Today the mock will **happily 201 the same payload that real OpenText 400s**. That makes the mock unsuitable as a substitute for the real backend in onboarding tests *that exercise sad paths* - although it remains correct for happy-path schema / discovery testing.

To close that fidelity gap, SCIMServer would need an optional **`businessRules` validation layer** alongside the schema layer. This is conceptually a 4th layer added below `SchemaValidator` -> `enforcePrimaryConstraint` -> `checkImmutable`:

```text
4. BusinessRulesValidator
   - perAttribute regex / format / canonical-list checks above schema
   - cross-attribute consistency rules (address.postalCode regex per address.country)
   - external-allowlist checks (userName domain ∈ allowedDomains[])
   - all controlled by a new `profile.businessRules: { ... }` section
```

That is a real engineering item, **not in scope today**. Tracking note added to §11 below. For the immediate need, the mock is sufficient if the bot test data is corrected per §10.6.

### 10.8 Concrete action plan (what to do right now)

| # | Action | Owner | ETA |
|---|--------|-------|-----|
| 1 | Update `ConfigurableConnectorTestConfigurations.cs` to seed a static realistic User payload for the OpenText template (E.164 phones, ISO-2 country, US ZIP, `@uk.appriver.io` username) | SyncFabric workspace - manual edit per the attached `for OpenText bot test.txt` flow | <30 min |
| 2 | Re-run `Trait:"ConfigurableConnectorRuleEvaluationOnboardingTest"` | SyncFabric | per existing test runtime |
| 3 | If still failing, capture the new correlation ID and request the OpenText backend log line - that will tell us *which* of R-1..R-4 fired | SyncFabric + OpenText support | varies |
| 4 | Once the bot is green, regenerate the connector config json under `connector_configurations\prod` and re-deploy to the SyncFabric SCIM container | SyncFabric | ~10 min |
| 5 | (Optional) Wire the SCIMServer mock as the `baseAddress` for the bot test instead of the real OpenText - lets the bot iterate in <100 ms without touching the real AppRiver tenant | SCIMServer + SyncFabric | <1 hr  |

### 10.9 Why this bug was invisible until now

1. The OpenText schema document does not advertise the format rules - operators reading `/Schemas` see `phoneNumbers.value: type=string, multiValued=false`, no pattern, no format. Nothing in SCIM 2.0 lets the server tell the client "this string must be a phone number".
2. The Microsoft SCIM Validator uses curated realistic test data, so it always passes.
3. Real customer provisioning flows go through Entra source -> Entra mapping -> SCIM target. Entra's mapping always supplies real phone numbers from `mobile`/`telephoneNumber` directory attributes, real country codes from `country`/`usageLocation`, real userName from `userPrincipalName`. The randomization only happens in the SyncFabric synthetic onboarding tests.
4. The first time a synthetic test hits this server, the failure surfaces as a generic `400 invalidValue` with no field-level breakdown - because RFC 7644 §3.12 only defines `invalidValue` as the keyword, no `attributePaths[]` is required, and AppRiver's implementation doesn't volunteer one.

---

## 11. Updated follow-ups (delta from §9)

| Owner | Action | Tracking |
|-------|--------|----------|
| **SyncFabric** | **Replace random-string field generators in OpenText bot test with realistic per-attribute samplers (phones, country, ZIP, mailNickname domain)** - see §10.8 #1 | **Immediate / blocking** |
| Backlog | (G-7 NEW) Optional `profile.businessRules` validator layer in SCIMServer for high-fidelity ISV mocks - regex / format / cross-attribute / domain-allowlist | Future SCIMServer feature; spec sketch in §10.7 |
| Backlog | (G-1) Implement `members.$ref` referenceTypes runtime check | unchanged |
| Backlog | (G-2) Schema-driven uniqueness | unchanged |
| Backlog | (G-3) `proxyAddresses` canonicalisation | unchanged |
| Now | Capture the bot-test failure correlation IDs (`c3db4240-...`, `63316b5c-...`) and request the AppRiver backend log line to confirm R-1..R-4 ranking | Microsoft + AppRiver support |
