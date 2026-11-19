# Visual Studio - Debugging Node (SCIMServer API) Quickstart

> Updated: November 18, 2026 · Applies to: Node 24 / SCIMServer

**Last verified:** 2026-11-18

The independent Engine/WSL transport, actual API inspector and source-edit
restart were exercised. Visual Studio 2022 menu interaction and breakpoint
mapping were not newly GUI-tested. See the
[runtime setup and limitations](CONTAINER_RUNTIME_MIGRATION_ASSESSMENT.md#operator-workflow-for-the-installed-windows-route)
before using container debugging from Windows.

This snippet shows exact Visual Studio 2022 menu steps and sample attach settings to debug the `api` Node process locally or inside Docker using the Node inspector (port 9229).

Prerequisites
- Visual Studio 2022 with **Node.js development** workload installed.
- A Docker-compatible Linux engine and Compose 2.32+ for container debugging.
  The selected Windows route uses independent Docker Engine in Ubuntu WSL,
  independent Windows clients and pinned loopback SSH, not Docker Desktop.
- Node.js 24+ installed (for local runs).

Option A - Debug the API script directly from Visual Studio (recommended)
1. Open Visual Studio 2022.
2. `File > Open > Folder...` and choose the repository root (contains the `api/` folder).
3. In Solution Explorer expand `api/package.json` and view `Scripts`.
4. Right-click the `start:dev` script and choose `Debug '<start:dev>'`.
   - Visual Studio runs the npm script and attaches the debugger.
5. Set breakpoints in TypeScript files under `api/src` (e.g., `admin.controller.ts`).
6. Make requests to the configured API port, for example
   `/scim/endpoints/<endpointId>/Users`, to trigger the breakpoints.

Option B - Start Node with inspector and Attach to Process
(Local run)
1. Open a terminal in the `api` directory.
2. Start the server with inspector:

```powershell
$env:PORT = '3000'
node --watch --inspect=127.0.0.1:9229 `
  --require ts-node/register/transpile-only src/main.ts
```

3. In Visual Studio: `Debug > Attach to Process...`.
4. In the Attach to Process dialog:
   - Set `Transport` to `Node.js remote` (or `Default` if Node option not present).
   - If prompted, set `Qualifier` to `localhost:9229`.
   - If using the process list, locate the `node.exe` running your server and click `Attach`.
5. Set breakpoints in `api/src` and send requests to `http://localhost:3000`.

(Remote Docker)
1. Activate the independent runtime in this terminal as described in the
   linked runbook. Set `NPM_REGISTRY` to the approved package transport when
   required by the device. Run the base model plus debug overlay, not the
   overlay alone:

```powershell
docker compose -f docker-compose.yml -f docker-compose.debug.yml watch
```

2. In Visual Studio: `Debug > Attach to Process...`.
   - Choose `Connection Type` = `Node.js remote` or `TCP/IP` and set `Qualifier` to `localhost:9229`.
   - Click `Attach`.
3. Ensure `localRoot` maps to `${workspaceFolder}/api` and remote root is `/usr/src/app` if prompted.
4. Set breakpoints and exercise the API.

Host-side Compose watch is necessary for Windows source edits because Linux
Node watch did not observe those bind-mount edits in the real WSL trial.
Generated Prisma output is isolated and ignored by watch; migrations run
before the API. Restart repeats dependency bootstrap and can take minutes.
For a faster inner loop, use native Windows Node with PostgreSQL hosted by
the independent Engine. For generated standalone packages, apply migrations
using the repository's Prisma configuration first; the existing packaged
`-RunMigrations` route is not qualified. The in-memory Operations inventory
also has a pre-existing dependency-wiring defect. Both limitations are
tracked in the runtime assessment rather than hidden by a health-only check.

Sample attach settings (if asked for mapping):
- Local root: `C:\Users\<youruser>\source\repos\SCIMServer\api`
- Remote root: `/usr/src/app`

Tips
- If breakpoints are not hit, ensure the running process uses the exact source files (no stale transpiled files) and source maps are enabled when using transpilation.
- For production images that do not mount source code, use a dev Docker setup that mounts the host directory into the container as shown in `docker-compose.debug.yml`.
