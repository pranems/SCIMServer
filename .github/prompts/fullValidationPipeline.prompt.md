---
name: fullValidationPipeline
description: Build, test locally, then build and test a Docker container end-to-end.
argument-hint: Optional flags or test script paths to customize the validation run.
---

Perform a full end-to-end validation pipeline for the current project. Follow these steps sequentially, stopping if any step fails:

## Phase 1 — Local Build & Validation
1. **Clean build**: Run a clean/fresh build of the project locally (install dependencies if needed, compile/transpile).
2. **Run unit tests**: Execute the full unit test suite and confirm all tests pass.
3. **Start local instance**: Launch the application locally (using the project's standard dev/start command).
4. **Run live/integration tests**: Execute the live or integration test suite against the running local instance.
5. **Stop local instance**: Shut down the local server after tests complete.

## Phase 2 — Docker Build & Validation
6. **Build Docker image**: Create a fresh Docker image using the project's Dockerfile (use `--no-cache` if appropriate).
7. **Start Docker container**: Run the newly built image as a local Docker container, ensuring all required environment variables and dependent services (e.g., databases) are configured.
8. **Health check**: Verify the container is healthy and the application is responding.
9. **Run live/integration tests**: Execute the same live/integration test suite against the Docker container endpoint.
10. **Stop and clean up**: Stop the container and optionally remove it.

## Reporting
- After each phase, report a summary of test results (pass/fail counts).
- If any step fails, diagnose the issue, attempt a fix, and re-run from the failing step.
- At the end, provide a final summary comparing local vs. Docker test results.
