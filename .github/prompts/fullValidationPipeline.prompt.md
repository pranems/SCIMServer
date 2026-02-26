---
name: fullValidationPipeline
description: Build, test locally, then build and test a Docker container end-to-end.
argument-hint: Optional flags or test script paths to customize the validation run.
---

Perform a full end-to-end validation pipeline for the current project. Follow these steps sequentially, stopping if any step fails:

## Phase 1 — Local Build & Validation
1. **Clean build**: Run a clean/fresh build of the project locally (install dependencies if needed, compile/transpile).
2. **Run unit tests**: Execute the full unit test suite and confirm all tests pass.
3. **Run E2E tests**: Execute the E2E test suite (these spin up their own app instance internally).
4. **Start local instance**: Launch the application locally using a **background** process so the terminal returns immediately. Then poll the endpoint until it responds.
5. **Run live/integration tests**: Execute the live or integration test suite against the running local instance.
6. **Stop local instance**: Shut down the local server after tests complete.

## Phase 2 — Docker Build & Validation

> **⚠️ CRITICAL — Docker terminal safety:**
> - **NEVER** run `docker compose up` without the `-d` (detached) flag. Without `-d` the command streams container logs forever, floods the terminal buffer, and freezes VS Code.
> - **ALWAYS** separate build and start: run `docker compose build` first, then `docker compose up -d`.
> - **Poll health** with `docker compose ps` or `docker ps`, NOT by watching log output.
> - If you need logs, use `docker compose logs --tail 30 <service>` (bounded).

6. **Clean up existing containers**: Run `docker compose down --remove-orphans` to ensure a clean slate.
7. **Build Docker image**: Run `docker compose build --no-cache` (this is a long but finite command — let it complete).
8. **Start Docker containers (detached)**: Run `docker compose up -d` — this returns immediately. Do NOT use `--build` here (already built in step 7).
9. **Health check**: Poll readiness by running `docker compose ps` or `docker ps --format "table {{.Names}}\t{{.Status}}"` until containers show `(healthy)`. If a container fails to become healthy within 90s, run `docker compose logs --tail 30 <service>` to diagnose.
10. **Run live/integration tests**: Execute the same live/integration test suite against the Docker container endpoint.
11. **Stop and clean up**: Stop the container and optionally remove it. If the user asked to keep it running, skip this step.

## Reporting
- After each phase, report a summary of test results (pass/fail counts).
- If any step fails, diagnose the issue, attempt a fix, and re-run from the failing step.
- At the end, provide a final summary comparing local vs. Docker test results.

## Self-Improvement Check

After completing the full pipeline, critically evaluate **this prompt itself** for accuracy, completeness, and efficiency. Ask these questions and apply fixes directly to `.github/prompts/fullValidationPipeline.prompt.md`:

### Build & Dependency Self-Check
1. **Did the build command work?** If `tsc -p tsconfig.build.json` failed or a different build command was needed (e.g., `nest build`, `npm run build`), update Phase 1 Step 1.
2. **Were dependency install steps needed?** If `npm install`, `npm ci`, or `npx prisma generate` had to run first, add them as explicit prerequisites.
3. **Did the clean build require cache clearing?** If `rm -rf dist/` or `rm -rf node_modules/.cache` was necessary, document it.

### Test Runner Self-Check
4. **Did the Jest commands work as written?** If CLI flags changed (e.g., `--testPathPatterns` vs `--testPathPattern`, `--forceExit` needed, `--detectOpenHandles` required), update the implied commands.
5. **Did JSON output parsing work?** If `--json --outputFile` was used and NestJS logs contaminated stdout, document the `2>$null` workaround and preferred parsing approach (`node -e` or `ConvertFrom-Json`).
6. **Did the E2E config path change?** If `test/e2e/jest-e2e.config.ts` moved or was renamed, update references.
7. **Were there new test levels?** If contract tests, snapshot tests, or performance tests now exist, add them as optional pipeline steps.

### Local Instance Self-Check
8. **Did the start command work?** If the local server required environment variables, database setup, or a specific start script beyond `npm run start:dev`, update Phase 1 Step 4.
9. **Did the health poll work?** If the health endpoint changed (e.g., from `/health` to `/api/health`, or requires auth), update the polling guidance.
10. **What port did it run on?** If the default port changed from 6000, update references.
11. **Did the stop command work?** If `Stop-Process` or `kill` required different flags or the PID tracking method changed, update Phase 1 Step 6.

### Docker Self-Check
12. **Did the Dockerfile change?** If the project now uses `Dockerfile.optimized`, `Dockerfile.ultra`, or a different compose file (`docker-compose.debug.yml`), update Phase 2 Step 7.
13. **Did compose service names change?** If service names in `docker-compose.yml` changed, update `docker compose logs <service>` references.
14. **Did the Docker health check work?** If the container health check mechanism changed (e.g., from HTTP to TCP, or a different endpoint), update Phase 2 Step 9.
15. **Did the Docker port mapping change?** If the container no longer maps to port 8080, update the live test endpoint guidance.
16. **Did Docker credentials change?** If the client secret for Docker mode changed from `docker-secret`, update the live test invocation.
17. **Did `docker compose build --no-cache` take excessively long?** If a cached build is acceptable for routine runs, consider making `--no-cache` optional or documenting both options.

### Live Test Self-Check
18. **Did the live test script path change?** If `scripts/live-test.ps1` moved or was renamed, or the invocation flags changed (`-BaseUrl`, `-ClientSecret`), update both Phase 1 and Phase 2.
19. **Did the live test require new parameters?** If new flags were added (e.g., `-SkipCleanup`, `-Verbose`, `-EndpointId`), document them.
20. **Did the test result format change?** If `Test-Result` output format or section numbering conventions changed, note it for reporting accuracy.

### Pipeline Flow Self-Check
21. **Was the step ordering optimal?** If a phase could be parallelized (e.g., unit and lint in parallel), note the optimization.
22. **Were there missing phases?** If lint, format check, security scan, or migration steps should be part of the pipeline, add them.
23. **Were there unnecessary steps?** If any step was redundant or always skipped, consider making it conditional.
24. **Did the "stop on failure" strategy work?** If some failures are non-blocking (e.g., lint warnings), consider adding severity levels.

### Reporting Self-Check
25. **Was the report format sufficient?** If the summary table needs new columns (e.g., duration, coverage %), update the Reporting section.
26. **Were there comparison gaps?** If local vs. Docker results differed for environmental reasons (e.g., different Node versions, different DB), document common causes.

Apply all identified improvements directly to this file so the next pipeline run is smoother and more accurate.
