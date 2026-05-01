# ADR-004: Keep `enableImplicitConversion: true` in the ValidationPipe

> **Status:** Accepted | **Date:** 2026-04-30 | **Deciders:** SCIMServer maintainers  
> **Closes:** S-5 in [docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md](../DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md)  
> **Supersedes:** none | **Superseded by:** none

---

## 1. Context

The global `ValidationPipe` in [api/src/main.ts](../../api/src/main.ts) is configured with:

```typescript
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  }),
);
```

The `enableImplicitConversion: true` option causes class-transformer to coerce primitive types based on the declared TypeScript type of the DTO property. For example, a query string `?count=50` arrives as the string `"50"` from Express, and class-transformer converts it to the number `50` because `count` is declared as `number`.

The [security audit S-5](../DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md#4-security-issues-s1s5) flagged this as a Medium-severity concern: combined with index signatures (`[key: string]: unknown`) on some DTOs, implicit conversion theoretically allows type confusion (`"true"` -> `true`, `"123"` -> `123`) on attributes the validator does not gate.

## 2. Decision

**Keep `enableImplicitConversion: true`.**

The decision is paired with three explicit mitigations that already exist or are now enforced:

1. Every typed DTO property uses an explicit class-validator decorator (`@IsString`, `@IsInt`, `@IsBoolean`, `@MaxLength`, `@IsIn`, etc.). The validator runs **before** the controller handler receives the value, so any mismatch between the conversion result and the declared type is rejected with a 400 SCIM error.
2. The new `parseSimpleFilter()` length cap added by [DTO-1](../DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md#8-dto-validation-gaps-dto1dto5) closes the largest practical exploitation surface (memory DoS via oversized filter strings).
3. The `forbidden-source-patterns.spec.ts` suite now includes an S-5 entry that locks in the current `enableImplicitConversion: true` literal in `main.ts`. Any future flip of this flag requires updating both the source and this ADR.

## 3. Considered Alternatives

### Option A: Keep `enableImplicitConversion: true` (selected)

| Pros | Cons |
|---|---|
| Zero code churn; preserves working query-param behavior on `?startIndex=10&count=50` | Theoretical type-confusion risk on undeclared DTO properties |
| Idiomatic NestJS pattern; matches the framework's documented happy path | Couples DTO declaration to runtime coercion semantics |
| All DTOs are individually validated by class-validator before the handler runs | Surprises in prototype pollution scenarios remain (mitigated by `whitelist: true` on individual DTOs and existing patch-engine guards) |

### Option B: Disable `enableImplicitConversion`

| Pros | Cons |
|---|---|
| Eliminates implicit coercion entirely; "what you typed is what you get" | Every numeric query param (`startIndex`, `count`, page numbers, durations) becomes a string at the controller and must be hand-parsed |
| Closes the theoretical type-confusion vector | Existing 5,274-test suite would need significant rewrites to either parse manually or use `@Transform()` decorators on every numeric field |
| Aligns with strict TypeScript hygiene | High disruption-to-benefit ratio for a Medium-severity theoretical risk that is not exploited in any audited DTO |

### Option C: Per-controller ValidationPipe with selective conversion

| Pros | Cons |
|---|---|
| Surgical: enable conversion only where needed | Loses single-source-of-truth for validation behavior; new controllers easy to forget to wire |

## 4. Consequences

### Positive

- No code changes required; zero regression risk.
- Existing 5,274-test coverage continues to validate end-to-end behavior of every DTO.
- The pattern is locked in by the security regression spec, so future drift is detected at PR time.

### Negative

- The Medium-severity audit finding remains formally "accepted risk" rather than "fixed." Mitigations (mandatory class-validator decorators, DTO-1 length cap, regression guard) are documented and enforced.
- Any future DTO author must remember that adding an undecorated field opens a (small) type-confusion window. PR template (OPS-4) checklist will be updated to include this as a review item.

### Neutral

- This is the recommended class-transformer pattern in the NestJS docs; choosing Option A keeps us on the well-trodden path.

## 5. Validation

The S-5 entry in [api/src/security/forbidden-source-patterns.spec.ts](../../api/src/security/forbidden-source-patterns.spec.ts) asserts the specific literal `enableImplicitConversion: true` is present in `api/src/main.ts`. If a future change disables it, the spec fails and forces an update to this ADR (either superseding it with a new ADR or removing the regression rule).

## 6. References

- [docs/DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md](../DESIGN_IMPROVEMENT_DEEP_ANALYSIS.md) Section 4 (S-5)
- [docs/DELIVERY_PLAN.md](../DELIVERY_PLAN.md) Section 3.2 (S-5 row)
- [class-transformer docs](https://github.com/typestack/class-transformer#enable-implicit-conversion)
- [NestJS ValidationPipe docs](https://docs.nestjs.com/techniques/validation)
