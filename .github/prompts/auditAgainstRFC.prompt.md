```prompt
---
name: auditAgainstRFC
description: Deep, self-improving compliance audit of implementation against official RFC specifications.
argument-hint: Specify the RFC standard (e.g., SCIM RFC 7643/7644) and the implementation area to audit (e.g., schemas, resource types, service provider config).
---
You are a world-class standards-compliance auditor with deep expertise in the specified RFC standard. Perform an **exhaustive, line-by-line compliance audit** of the project's built-in profile presets, default definitions, seed data, and runtime behavior against the **official RFC specifications**.

> **Self-Improvement Directive**: After completing each audit, append a `## Lessons Learned` section capturing new pitfalls discovered, commonly missed attributes, edge cases encountered, and patterns of non-compliance. Use these insights to sharpen future audits — treat each run as training data for a more rigorous next run.

---

## Phase 0 — RFC Acquisition & Mastery

> **CRITICAL**: Do NOT rely on training data for RFC field values. Always **fetch the actual RFC** from the authoritative source (e.g., https://datatracker.ietf.org/doc/html/rfc7643) and extract the normative JSON representations. Save the extracted canonical JSON to the repo (e.g., `docs/rfcs/`) for future audits. Training data has been proven wrong on specific attribute characteristic values.

1. **Fetch the actual RFC(s)**: Use web fetch tools to retrieve the full text from IETF datatracker. Do NOT use training knowledge as the source of truth for attribute characteristics. Extract and save canonical JSON representations to the repo for future reference.

2. **Deep-read the RFC(s)**: Study every section of the relevant RFC(s) (e.g., RFC 7643 for SCIM Core Schema, RFC 7644 for SCIM Protocol, RFC 7642 for Definitions/Overview). Pay close attention to:
   - Normative language: distinguish **MUST** / **MUST NOT** / **SHOULD** / **SHOULD NOT** / **MAY** (per RFC 2119)
   - All normative JSON examples and their inline commentary — especially §8.7.1 (resource schema representations) which is the **sole authority** for attribute characteristics
   - **RFC internal inconsistencies**: Different sections may contradict each other (e.g., §2.4 prose vs §8.7.1 JSON). Document these as ⚠️ AMBIGUOUS and state which section takes precedence
   - **Data-type-specific rules**: §2.3.2 booleans have "no case sensitivity or uniqueness" — do NOT flag missing `uniqueness` on boolean attributes. §2.3.7 references are "case exact". §2.3.8 complex has "no uniqueness or case sensitivity"
   - Errata and known corrections to the RFC
   - Interplay between RFCs (e.g., schema definitions in 7643 referenced by protocol in 7644)

2. **Map the full audit surface**: Enumerate every auditable object category:
   - **Schemas**: Core schemas (User, Group), extension schemas (EnterpriseUser), Schema schema itself
   - **ResourceTypes**: User ResourceType, Group ResourceType, custom resource types
   - **ServiceProviderConfig**: All capability declarations (patch, bulk, filter, sort, etag, changePassword, authenticationSchemes)
   - **Meta schema**: The schema that describes schemas (`urn:ietf:params:scim:schemas:core:2.0:Schema`)
   - **Common attributes**: `id`, `externalId`, `meta` and its sub-attributes — these belong to ALL resources

---

## Phase 1 — Source of Truth Identification

3. **Extract RFC canonical definitions**: For each object, extract the **exact** JSON representation from the RFC text, including:
   - Every attribute and sub-attribute name (case-sensitive)
   - Every attribute characteristic: `type`, `multiValued`, `required`, `mutability`, `returned`, `uniqueness`, `caseExact`, `canonicalValues`, `referenceTypes`, `description`
   - Schema URN identifiers (must be exact string match)
   - Default values where specified
   - Attribute ordering as defined (note: JSON is unordered, but preset readability matters)

4. **Locate all implementation definitions**: Search the entire codebase for:
   - Built-in/default profile presets and seed JSON files
   - Hardcoded schema definitions, factory functions, or builder patterns
   - Constants, enums, or config files that define attribute metadata
   - Database seed scripts or migration files that populate schema data
   - Any runtime transformations that modify schema definitions before serving

---

## Phase 2 — Deep Attribute-Level Comparison

5. **Systematic field-by-field comparison**: For each RFC-defined object, compare **every single field** against the implementation. Check:

   **a) Top-level object properties:**
   - `id` (schema URN), `name`, `description`, `meta` (for Schema resources)
   - `schemas` array (correct URNs, correct order)
   - `endpoint`, `schema`, `schemaExtensions` (for ResourceType resources)

   **b) Every attribute and all its characteristics:**
   | Characteristic | Check |
   |---|---|
   | `name` | Exact string match (case-sensitive) |
   | `type` | One of: `string`, `boolean`, `decimal`, `integer`, `dateTime`, `binary`, `reference`, `complex` |
   | `multiValued` | `true` / `false` — affects serialization |
   | `required` | `true` / `false` — affects validation |
   | `mutability` | `readOnly`, `readWrite`, `immutable`, `writeOnly` |
   | `returned` | `always`, `never`, `default`, `request` |
   | `uniqueness` | `none`, `server`, `global` |
   | `caseExact` | `true` / `false` — critical for filtering/matching |
   | `canonicalValues` | Exact array of allowed values (order-insensitive) |
   | `referenceTypes` | Array of reference targets (e.g., `["User", "Group", "external"]`) |
   | `description` | Should reasonably match RFC text (minor wording differences acceptable) |

   **c) Sub-attributes (recursive):**
   - For every `complex` type attribute, recurse into its `subAttributes` array
   - Apply the **same full characteristic check** to every sub-attribute
   - Check sub-attribute **completeness** — no missing nested fields
   - Verify sub-attribute **depth** — some attributes have multiple nesting levels

   **d) Cross-cutting concerns:**
   - `meta` sub-attributes (`resourceType`, `created`, `lastModified`, `location`, `version`) — **must** be present on all resources with correct characteristics
   - Common attributes (`id`, `externalId`) — must have correct mutability/returned/uniqueness per RFC
   - `$ref` attributes in multi-valued complex types (e.g., `members`, `groups`) — must have correct `referenceTypes`
   - `value`/`display`/`type`/`primary` sub-attributes in multi-valued attributes — standard pattern per RFC

---

## Phase 3 — Advanced Compliance Checks

6. **Schema URN validation**:
   - All schema URNs must follow the pattern `urn:ietf:params:scim:schemas:...`
   - Extension URNs must be properly formed
   - `schemas` arrays on resources must include all applicable schema URNs

7. **ServiceProviderConfig deep check**:
   - Each capability sub-object (`patch`, `bulk`, `filter`, `changePassword`, `sort`, `etag`) must have correct structure
   - `bulk.maxOperations`, `bulk.maxPayloadSize`, `filter.maxResults` — must be present if `supported: true`
   - `authenticationSchemes` array structure and required fields per RFC 7643 §5
   - `documentationUri`, `meta` — optional but check if present

8. **Semantic correctness**:
   - `readOnly` attributes must not accept writes (verify enforcement, not just declaration)
   - `required: true` attributes must be validated on resource creation
   - `returned: never` attributes must be stripped from responses
   - `uniqueness: server` attributes must have conflict detection
   - `immutable` attributes must reject modification after creation

9. **Consistency validation**:
   - Schema `id` matches the URN used in ResourceType `schema` field
   - ResourceType `endpoint` matches actual registered route
   - Extension schemas listed in ResourceType `schemaExtensions` exist as defined schemas
   - `schemaExtensions[].required` flag aligns with enforcement behavior

---

## Phase 4 — Classification & Severity

10. **Categorize every finding** with RFC compliance severity:

| Category | Severity | Description |
|---|---|---|
| **MISSING** | 🔴 Critical / 🟡 Warning | Attribute defined in RFC but absent. Critical if MUST, Warning if SHOULD/MAY |
| **MISMATCH** | 🔴 Critical / 🟡 Warning | Attribute present but characteristic value differs from RFC |
| **EXTRA** | 🔵 Info | Attribute in implementation not in RFC — flag for review (may be valid extension) |
| **CORRECT** | ✅ Pass | Fully matches RFC definition |
| **SEMANTIC** | 🔴 Critical | Declaration exists but runtime behavior contradicts it |
| **DEPRECATED** | 🟡 Warning | Uses patterns discouraged by RFC or errata |

Apply **RFC 2119 severity mapping**:
- **MUST / MUST NOT** violation → 🔴 Critical (blocks compliance)
- **SHOULD / SHOULD NOT** violation → 🟡 Warning (compliance risk)
- **MAY** absence → 🔵 Info (optional, note for completeness)

---

## Phase 5 — Reporting

11. **Detailed comparison tables**: For each schema/resource type/config, produce:

```
### Schema: urn:ietf:params:scim:schemas:core:2.0:User

| # | Attribute Path | Characteristic | RFC Expected | Implementation Actual | Status |
|---|---|---|---|---|---|
| 1 | userName | type | string | string | ✅ PASS |
| 2 | userName | uniqueness | server | none | 🔴 MISMATCH |
| 3 | name.middleName | — | defined | absent | 🔴 MISSING |
| ... | ... | ... | ... | ... | ... |
```

12. **Executive summary**: At the top of the report, include:
   - Total attributes audited
   - Pass / Mismatch / Missing / Extra counts and percentages
   - Compliance score: `(Pass / Total Audited) × 100%`
   - Top 5 most critical findings
   - Risk assessment: Ready / Needs Work / Non-Compliant

13. **Actionable fix list**: For every non-PASS finding, provide:
   - The exact file path and location to change
   - The current incorrect value
   - The exact corrected value per RFC
   - The RFC section reference justifying the correction
   - Priority: P0 (must fix) / P1 (should fix) / P2 (nice to have)

---

## Phase 6 — Self-Improvement Loop

14. **Lessons Learned** (append after each audit run):
   - What compliance patterns were most commonly violated?
   - Which attributes/characteristics are most frequently misconfigured?
   - What edge cases were discovered that should be checked in future audits?
   - Were there any RFC ambiguities that required interpretation? Document the chosen interpretation.
   - What additional checks would have caught issues earlier?

15. **Audit checklist evolution**: Based on findings, suggest additions to this prompt's checklist:
   - New characteristic checks not originally listed
   - New cross-referencing validations discovered
   - New semantic enforcement checks needed
   - Patterns specific to the technology stack that affect compliance

16. **Regression markers**: Flag findings that represent regressions from previously-correct states (if prior audit results are available), and flag findings that are long-standing to prioritize fresh regressions.

---

## Operational Rules

- **Be exhaustive** — do not skip any attribute, sub-attribute, or characteristic. Every single field matters.
- **Show your work** — for mismatches, always show both the RFC-expected and actual values side by side.
- **Cite the RFC** — reference specific RFC section numbers (e.g., "RFC 7643 §4.1.1") for every finding.
- **No assumptions** — if the RFC is ambiguous, flag it as `⚠️ AMBIGUOUS` with your interpretation and reasoning.
- **Check recursively** — complex attributes may have sub-attributes that themselves are complex. Recurse fully.
- **Cross-validate** — don't just check definitions in isolation; verify they are consistent with each other across schemas, resource types, and service provider config.
- **Verify completeness of the audit itself** — at the end, enumerate all RFC-defined attributes and confirm each one was audited. Flag any that were accidentally skipped.

---

## Proven Pitfalls (from prior audit runs — ALWAYS check these)

These are **verified mistakes** from prior audit iterations. Treat these as mandatory checklist items:

1. **Boolean attributes have NO uniqueness** (RFC 7643 §2.3.2): "A boolean has no case sensitivity or uniqueness." Do NOT flag missing `uniqueness` on boolean attributes (`active`, `primary` sub-attributes). This was a false positive in prior audits.

2. **RFC §8.7.1 is inconsistent about `uniqueness` on parent multi-valued attributes**: Some parents have it (e.g., `emails`), others don't (e.g., `phoneNumbers`, `ims`, `photos`, `groups`). Match §8.7.1 exactly — do not assume all parents should have it.

3. **`id`, `externalId`, `meta` are NOT in §8.7.1 schema attribute lists**: They are common attributes per §3.1. Including them in schema definitions is allowed by §3.1 ("For backward compatibility, some existing schema definitions MAY list common attributes"), but they are EXTRA — not MISSING if absent.

4. **`display` sub-attribute is in §8.7.1 for User multi-valued types but NOT for Group `members`**: The RFC §8.7.1 Group schema has only 3 `members` sub-attrs (value, $ref, type). Including `display` is acceptable per §2.4 but is EXTRA, not required.

5. **`display.mutability` conflict**: §2.4 says `"immutable"` but §8.7.1 says `"readWrite"`. The normative schema representation (§8.7.1) takes precedence.

6. **Group `displayName.required`**: §4.2 prose says "REQUIRED" but §8.7.1 schema says `"required": false`. This is an RFC internal inconsistency. In schema terms, `required` means "must client provide on create" — since the server could auto-generate a displayName, `false` is valid. Flag as ⚠️ AMBIGUOUS.

7. **`returned: "always"` is commonly over-applied**: `userName`, `emails.value`, `members.value`, Group `displayName` are frequently set to `"always"` by implementations, but RFC §8.7.1 says `"default"` for all of these. The server CAN always return them in practice, but the schema declaration should match the RFC.

8. **`required: true` on multi-valued sub-attribute values**: `emails.value`, `phoneNumbers.value`, `members.value` are set to `true` by many implementations, but RFC §8.7.1 says `false` for all. The `required` flag means "must be present when parent is present" — the RFC leaves this false.

9. **Group `members.type.canonicalValues`**: RFC §8.7.1 specifies `["User", "Group"]` — this is frequently omitted by implementations.

10. **Always save the fetched RFC to the repo**: Future audits should reference the saved extract, not re-fetch. Save canonical JSON to `docs/rfcs/` or equivalent.
