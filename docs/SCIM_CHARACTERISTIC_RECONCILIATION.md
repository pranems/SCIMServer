# SCIM Attribute Characteristic Reconciliation

**Status:** Complete on local consolidation source - not deployed
**Last verified:** 2026-09-29
**Source:** `7332fdbcc70762a8f5ace4c5a63c67b00582eb87`

## Outcome

The remaining "broader characteristic overlays" item was an evidence-mapping
gap, not another production defect. The final mapping enumerates the
combinations actually exercised across the current 82-case dual-backend
corpus, the P7/P7b contract suites, retained-entry tests, and
binding-qualified uniqueness tests. It does not claim exhaustive Cartesian
coverage of every characteristic value.

No new production behavior was needed. The mapped evidence covers both strict
modes, User, Group, and custom resource adapters, core and extension
namespaces, scalar and multi-valued representations, complex children, and
the persistence boundaries that differ between InMemory and PostgreSQL.

## Reconciled matrix

| Boundary | Enumerated combinations | Permanent evidence |
|---|---|---|
| Declaration shape and defaults | Omitted defaults; Boolean declarations; valid type/mutability/returned/uniqueness keywords; malformed containers and keywords | `profile-declaration-p7.spec.ts`, `profile-validation-p7.e2e-spec.ts` |
| Type and cardinality | Eight SCIM types in scalar and multi-valued form; nested complex child lists; wrong scalar/list representations | `TYPES-*` and `CARDINALITY-NEGATIVE-*` in the current 82-case evidence; P7 POST/PUT contracts |
| Namespace and adapter | Core and extension attributes on User, Group, and custom resources in strict ON and OFF modes | `profile-validation-p7.e2e-spec.ts`, `patch-schema-contract.e2e-spec.ts`, `typed-patch-path.e2e-spec.ts` |
| Required | Required core values, required extension bindings, required children, optional extension removal, and ordered PATCH transitions | P7 POST/PUT contracts and P7b PATCH schema contracts |
| readOnly | Top-level and recursive nested input stripping, cached and uncached paths, POST/PUT/PATCH, and authoritative server state retention | P7 contracts, recursive readOnly units, P7b namespace tests |
| immutable | Initial assignment, later replacement/removal rejection, omitted PUT preservation, null parent clearing, and retained duplicate array entries | `IMMUTABLE-*` cases, P7 contracts, `retained-entry-put.e2e-spec.ts` |
| writeOnly and returned:never | Core and extension values accepted for write but absent from POST/GET/LIST/PUT/PATCH/search and explicit projections | P7 contracts, `returned-characteristic.e2e-spec.ts`, `p2-attribute-characteristics.e2e-spec.ts` |
| returned modes | `always`, `default`, `request`, and `never`; implicit request presence and explicit inclusion/exclusion; core/extension homonyms | P7 POST/PUT, P7b PATCH response projection, `RETURNED-*` cases |
| caseExact | Exact and insensitive read filters, PATCH selectors, qualified namespaces, and query pushdown fallback | `CASEEXACT-*`, typed filter cases, query semantics units |
| uniqueness | `none` and `server`; scalar/MV/child paths; core/extension bindings; case rules; concurrent create/replace; unsupported type/global declarations | `binding-uniqueness.e2e-spec.ts`, `schema-driven-uniqueness.e2e-spec.ts`, `UNIQUE-*` cases |
| Multi-valued primary | One-primary handoff and rejection/normalization policy on core and extension complex arrays | `PRIMARY-*` cases and primary enforcement suites |
| Retained-entry ownership | Duplicate values/types, omitted/null type, reorder, insertion/deletion, readOnly versus immutable, and repeated PUT | `retained-entry-put.e2e-spec.ts` and retained-entry domain tests |
| Optional provider policies | `canonicalValues` remain suggestions; `global` uniqueness is rejected because this provider cannot guarantee it; reference syntax is validated without external URL fetching | P7 declaration and value contracts |

## Backend evidence

- Current 82-case run: 81 passed plus one accepted not-applicable on InMemory,
  82 passed on PostgreSQL, 769 outcome assertions, no failures.
- P7b guarded run: 571 HTTP cases on each backend, including P7 declaration,
  POST/PUT, PATCH, retained-entry, binding-uniqueness, and profile-revision
  suites.
- PostgreSQL ran version 17.8 with all 22 migrations. The current 82-case and
  P7b containers were exact-ID cleaned and used no persistent volumes.

Structured evidence:

- [Current 164-disposition ledger](evidence/scim-current-acceptance-20260929/validation.json)
- [Characteristic mapping](evidence/scim-characteristics-20260929/validation.json)

## Scope boundary

This reconciliation does not add canonical-value enforcement, external
reference resolution, or globally distributed uniqueness. RFC 7643 does not
require those provider policies, and adding them only to enlarge a test matrix
would change the product contract. Performance of residual query filtering is
assessed separately in
[SCIM_QUERY_PERFORMANCE_ASSESSMENT.md](SCIM_QUERY_PERFORMANCE_ASSESSMENT.md).

**Assurance improvement: applied.** The matrix names actual crossed
dimensions and permanent outcome assertions instead of treating a suite total
as exhaustive coverage.
**Design/architecture disposition: accepted.** Existing schema, PATCH,
projection, uniqueness, and repository seams are cohesive; another policy
engine would duplicate them without a second implementation need.
