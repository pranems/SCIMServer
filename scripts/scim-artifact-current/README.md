# Exact-tip built-runtime validation

This task-owned runner closes the local artifact gate without using a shared
database or deployment:

```powershell
node scripts\scim-artifact-current\check-safety.cjs
node scripts\scim-artifact-current\run.cjs
```

The runner requires a clean committed tip on
`integrate/scim-correctness-20260928`. It builds `api/dist`, starts that exact
artifact on a loopback random port with the InMemory backend, and executes the
tracked shared correctness contracts plus the P7b PATCH/schema corpus. It then
repeats the same checks against an empty, task-labeled PostgreSQL 17 container
with tmpfs storage after replaying every migration.

Evidence is written below `test-results/scim-artifact-current/`. Secrets are
random per run and redacted from logs. The API process is stopped by exact PID,
and PostgreSQL is removed only after its exact ID, name, owner label, and run
label match. The runner does not push, deploy, use a shared estate, modify
release metadata, or retain a database volume.
