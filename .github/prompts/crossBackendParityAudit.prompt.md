---
name: crossBackendParityAudit
description: Audit every code path that has a separate inmemory branch vs Prisma branch and verify both behave identically. Born from Finding-B (May 2026) where InMemory endpoint-create was missing the duplicate-name guard that Prisma had.
argument-hint: Optional - name a specific service or file (e.g. "EndpointService") to narrow the audit scope.
---

The codebase carries TWO repository implementations behind one interface: `PrismaRepositoryModule` (production / Docker / dev / prod) and `InMemoryRepositoryModule` (developer local dev, fast tests, RAM-only). Both are wired through `RepositoryModule.register()` and selected by `process.env.PERSISTENCE_BACKEND`.

When a code path has IF/ELSE branches keyed on `isInMemoryBackend`, it is an EXTREMELY high-risk site for drift. The two real precedents:
- **Phase D4 (2026-05-08)** - `LoggingService.listLogs` honored 9 filter dimensions on Prisma but only `endpointId` on inmemory. Silent gap; user-visible bug took weeks.
- **Finding-B (2026-05-16)** - `EndpointService.createEndpoint` rejected duplicate names on Prisma but allowed them on inmemory. Live-test section 9z-AA.5 caught it; would not have been caught by any unit/E2E test because they all mock one backend.

This prompt walks you through finding the next such bug BEFORE it ships.

---

## Step 1 - Enumerate every conditional inmemory branch in production source

```powershell
cd api/src
Get-ChildItem -Recurse -File -Include *.ts | Where-Object { $_.FullName -notmatch '\.spec\.ts$' } | ForEach-Object {
    $hits = Select-String -Path $_.FullName -Pattern 'isInMemoryBackend|PERSISTENCE_BACKEND.*inmemory|InMemoryRepository' -SimpleMatch
    if ($hits) { "{0,-80} {1} hits" -f $_.FullName.Substring((Resolve-Path .).Path.Length+1), $hits.Count }
}
```

Build a table of `(file, line, branch)` triples. Each row is a potential parity-gap site.

---

## Step 2 - For each branch, ask the four questions

For each `if (this.isInMemoryBackend)` block:

| Question | What it catches |
|---|---|
| **Q1: Does the Prisma branch do something the inmemory branch does NOT?** | Finding-B (missing duplicate-name guard) |
| **Q2: Does the Prisma branch FILTER, SORT, PAGINATE differently?** | Phase D4 (listLogs filter parity) |
| **Q3: Does the Prisma branch raise a different EXCEPTION TYPE or STATUS code?** | Silent 200-instead-of-409 class |
| **Q4: Does the Prisma branch EMIT EVENTS (SSE, audit log) that inmemory does not?** | Phase J SSE bridge before it was wired |

Document the answers in a parity matrix:

| Code path | Prisma behavior | InMemory behavior | Gap? |
|---|---|---|---|
| `EndpointService.createEndpoint` | findUnique -> 400 on dup | (gap) | Finding-B |
| `LoggingService.listLogs` | 10 filter dimensions | 1 (endpointId only) before D4 | Closed |
| ... | ... | ... | ... |

---

## Step 3 - For every gap, write a failing unit test FIRST

Pattern (from `logging-list-logs-inmemory.spec.ts`):

```typescript
const savedBackend = process.env.PERSISTENCE_BACKEND;
beforeEach(() => { process.env.PERSISTENCE_BACKEND = 'inmemory'; });
afterAll(() => { process.env.PERSISTENCE_BACKEND = savedBackend; });

// Mock Prisma with NO-OP stubs (Prisma must NOT be called on inmemory path,
// but the service constructor may still call methods like findMany during
// cache hydration - use plain jest.fn(), not a Proxy that throws).
const prisma = { endpoint: { findMany: jest.fn(), findUnique: jest.fn(), ... } };
```

Test the exact behavior the Prisma branch provides. If it throws BadRequestException, this test must assert the same. If it returns a 409, this test must assert 409. Run it - expect FAIL (RED).

---

## Step 4 - Implement the missing branch

Add the equivalent logic to the inmemory branch in the production file. Re-run the test - expect PASS (GREEN).

Then re-run the parallel Prisma-branch test (in `endpoint.service.spec.ts` or wherever) to confirm GREEN didn't regress.

---

## Step 5 - Add a live-test section that exercises the path against BOTH backends

The `scripts/live-test.ps1` script targets one URL; section 9z-AA.5 is the live equivalent of the Finding-B unit test. The way you verify multi-backend behavior at the live layer is:

1. Run `scripts/live-test.ps1` against `http://localhost:6000` (local node, inmemory).
2. Run `scripts/live-test.ps1` against `http://localhost:8080` (Docker compose, Prisma).
3. Run `scripts/live-test.ps1 -BaseUrl https://scimserver-dev...` (dev Azure, Prisma).

All three must produce identical pass counts. A divergence is a parity bug.

This is also what `scripts/test-all-modes.ps1` (Phase H5 orchestrator) automates at the API test layer for inmemory vs Prisma jest modes.

---

## Step 6 - Make the audit recurring

After every commit that touches a file with an `isInMemoryBackend` branch:
- Re-run Step 1 to update the enumeration.
- Add any new branches discovered to the parity matrix.
- Verify Steps 2-5 for the new branch.

---

## Anti-patterns to avoid

- **DO NOT** mock Prisma to throw inside an inmemory test. The service constructor may legitimately call Prisma during cache hydration. Use plain stubs.
- **DO NOT** assume "inmemory is just dev" - the very tests that ship our quality bar run in inmemory mode in some CI configurations.
- **DO NOT** add an inmemory branch without immediately adding an inmemory-mode unit test.

---

## Outputs

When this prompt completes, produce:
1. The parity matrix (Step 2 table) with every branch enumerated.
2. A list of confirmed gaps (rows where `Gap? = yes`).
3. A list of new specs added (one per closed gap).
4. Updated [test-all-modes.contract.ps1](scripts/test/test-all-modes.contract.ps1) if a new mode is needed.
