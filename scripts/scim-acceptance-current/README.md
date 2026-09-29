# Current-source SCIM acceptance runner

This wrapper reuses the immutable 82-case corpus under
`docs/evidence/scim-fresh-20260925/repro-postgres/` without editing its source,
historical guard, inputs, or evidence. It substitutes:

- a guard for the consolidation worktree and current clean API tree;
- normalized hashes for the immutable corpus files;
- a disposable PostgreSQL 17 container with task ownership, tmpfs storage,
  loopback-only publication, 22-migration replay, and exact cleanup;
- three explicit current-architecture adaptations in
  `corpus-transformer.cjs`.

The adaptations select the success assertions for a strict-mode incident that
is now valid and move two InMemory Group fault injections from the obsolete
`addMembers` seam to the aggregate `create` and `updateGroupWithMembers`
boundaries. The historical source remains unchanged.

```powershell
node scripts\scim-acceptance-current\check-safety.cjs
node scripts\scim-acceptance-current\run.cjs
node scripts\scim-acceptance-current\build-evidence.cjs <test-results-run-directory>
```

The runner accepts an optional focused case list:

```powershell
node scripts\scim-acceptance-current\run.cjs --cases INC-STRICT,GROUP-HTTP-FAULT
```
