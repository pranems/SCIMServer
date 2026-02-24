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
