# Phase D3 - Schemas Tab

> **Version:** 0.45.0-alpha.3 - **Date:** May 8, 2026  
> **Phase:** D3 of [UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md)  
> **Predecessor:** [Phase D2 - Activity Tab](PHASE_D2_ACTIVITY_TAB.md) (v0.45.0-alpha.2)  
> **Successor:** Phase D4 (Dashboard charts) -> v0.45.0-alpha.4  
> **Status:** Complete - new SchemasTab read-only tree view consuming the existing per-endpoint /Schemas discovery endpoint.

---

## 1. Summary

D3 ships the **Schemas tab** at `/endpoints/$endpointId/schemas`. It's a read-only tree view of every schema declared by the endpoint's profile, with characteristic badges per attribute and a one-click URN copy. Frontend-only - the SCIM `/Schemas` endpoint already exists from Phase 6 (data-driven discovery).

---

## 2. What D3 Delivers

| Surface | Detail |
|---------|--------|
| New page | [web/src/pages/SchemasTab.tsx](../web/src/pages/SchemasTab.tsx) - tree of schemas, expandable per attribute (and per complex sub-attribute) |
| New route | [web/src/routes/endpoints.$endpointId.schemas.tsx](../web/src/routes/endpoints.$endpointId.schemas.tsx) - nested route, A4 loader pre-fetch |
| New hook | `useEndpointSchemas(id)` - 5min staleTime (schemas rarely change) |
| New tab | `Schemas` inserted between `Activity` and `Logs` |
| Characteristics | Per-attribute Fluent badges: `type`, `required`, `mutability`, `returned`, `uniqueness`, `multiValued`, `caseExact` |
| Copy URN | Per-schema button copies the canonical schema URN via `navigator.clipboard.writeText` |
| Loading | `LoadingSkeleton count={5} height="56px"` mirroring schema-card layout (G1 pattern) |
| Empty | `EmptyState` "No schemas available" - covers SchemaDiscovery=disabled (404) and zero-schema endpoints |

---

## 3. Tests

| Layer | Count | Coverage |
|-------|-------|----------|
| Web vitest | 7 | LoadingSkeleton on isLoading / tree row per schema with attr count / characteristic badges on leaf / sub-attr expand / Copy URN button / EmptyState on zero schemas / error path |

### TDD evidence

- RED: SchemasTab.test.tsx imported a non-existent component -> module resolution failure
- GREEN: created SchemasTab.tsx, hook, queryOptions, route file, wired into router + tab list -> 7/7 tests pass + 385/385 full vitest pass
- REFACTOR: extracted `SchemaRow`, `AttributeLeaf`, `CharacteristicBadges` sub-components

### Test count delta

- Web vitest: **378 -> 385** (+7)
- API tests / live SCIM: unchanged (frontend-only, consumes existing `/Schemas` endpoint)
- Production build: clean (vite build 12.41s)

---

## 4. Definition of Done

- [x] Spec items 1-5 from S7.3 satisfied (tree view, characteristic display, URN copy, 5min cache, EmptyState)
- [x] +7 web vitest tests
- [x] Composes Phase C primitives (LoadingSkeleton + EmptyState)
- [x] Schemas cached 5min via `endpointSchemasQueryOptions`
- [x] No regressions: 385/385 vitest pass, build clean
- [x] Frontend-only: 0 backend test impact
- [x] Lockstep version bump api+web `0.45.0-alpha.2` -> `0.45.0-alpha.3`
- [x] Feature doc shipped (this file), INDEX.md updated, CHANGELOG entry, Session_starter.md log entry
- [ ] **Sub-phase quality gate:** deploy v0.45.0-alpha.3 to dev + 901+ live SCIM tests + 7 Playwright cases all pass (next step)

---

## 5. Cross-References

- [PHASE_D2_ACTIVITY_TAB.md](PHASE_D2_ACTIVITY_TAB.md) - D2 predecessor
- [PHASE_C_PRIMITIVES_AND_MUTATIONS.md](PHASE_C_PRIMITIVES_AND_MUTATIONS.md) - LoadingSkeleton + EmptyState consumed
- [api/src/modules/scim/controllers/endpoint-scim-discovery.controller.ts](../api/src/modules/scim/controllers/endpoint-scim-discovery.controller.ts) - server endpoint
- [UI_REDESIGN_REMAINING_GAPS_PLAN.md](UI_REDESIGN_REMAINING_GAPS_PLAN.md) S7.3 - parent spec
