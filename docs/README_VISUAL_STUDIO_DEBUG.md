# Visual Studio — Debugging Node (SCIMTool API) Quickstart

This snippet shows exact Visual Studio 2022 menu steps and sample attach settings to debug the `api` Node process locally or inside Docker using the Node inspector (port 9229).

Prerequisites
- Visual Studio 2022 with **Node.js development** workload installed.
- Docker Desktop (if debugging inside container).
- Node.js 18+ installed (for local runs).

Option A — Debug the API script directly from Visual Studio (recommended)
1. Open Visual Studio 2022.
2. `File ? Open ? Folder...` and choose the repository root (contains the `api/` folder).
3. In Solution Explorer expand `api/package.json` and view `Scripts`.
4. Right-click the `start:dev` script and choose `Debug '<start:dev>'`.
   - Visual Studio runs the npm script and attaches the debugger.
5. Set breakpoints in TypeScript files under `api/src` (e.g., `admin.controller.ts`).
6. Make HTTP requests to `http://localhost:3000/scim/v2/...` to trigger the breakpoints.

Option B — Start Node with inspector and Attach to Process
(Local run)
1. Open a terminal in the `api` directory.
2. Start the server with inspector:

```powershell
$env:NODE_OPTIONS="--inspect=9229"
npm run start:dev
```

3. In Visual Studio: `Debug ? Attach to Process...`.
4. In the Attach to Process dialog:
   - Set `Transport` to `Node.js remote` (or `Default` if Node option not present).
   - If prompted, set `Qualifier` to `localhost:9229`.
   - If using the process list, locate the `node.exe` running your server and click `Attach`.
5. Set breakpoints in `api/src` and send requests to `http://localhost:3000`.

(Remote Docker)
1. Use the provided `docker-compose.debug.yml` to run the API in a container with the inspector exposed:

```powershell
docker compose -f docker-compose.debug.yml up --build
```

2. In Visual Studio: `Debug ? Attach to Process...`.
   - Choose `Connection Type` = `Node.js remote` or `TCP/IP` and set `Qualifier` to `localhost:9229`.
   - Click `Attach`.
3. Ensure `localRoot` maps to `${workspaceFolder}/api` and remote root is `/usr/src/app` if prompted.
4. Set breakpoints and exercise the API.

Sample attach settings (if asked for mapping):
- Local root: `C:\Users\<youruser>\source\repos\SCIMTool2022\api`
- Remote root: `/usr/src/app`

Tips
- If breakpoints are not hit, ensure the running process uses the exact source files (no stale transpiled files) and source maps are enabled when using transpilation.
- For production images that do not mount source code, use a dev Docker setup that mounts the host directory into the container as shown in `docker-compose.debug.yml`.

If you prefer, I can also generate a Visual Studio `launch.vs.json` snippet or a `docker-compose` for both API and web services. Which would you like next?
