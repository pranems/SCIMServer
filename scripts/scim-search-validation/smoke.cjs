const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { ROOT, API, INERT, markerGuard } = require('./safety.cjs');

async function main() {
  markerGuard();
  const reservation = net.createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const secret = crypto.randomBytes(32).toString('hex');
  const server = cp.spawn(process.execPath, [path.join(API, 'dist', 'main.js')], {
    cwd: API,
    env: {
      ...process.env, DATABASE_URL: INERT, PERSISTENCE_BACKEND: 'inmemory',
      PORT: String(port), NODE_ENV: 'test', LOG_LEVEL: 'OFF', LOG_FILE: '',
      SCIM_SHARED_SECRET: secret, JWT_SECRET: secret, OAUTH_CLIENT_SECRET: secret,
    },
    stdio: 'ignore',
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      assert.equal(server.exitCode, null, 'Smoke API exited before readiness.');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/scim/health`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { ready = true; break; }
      } catch (error) {
        if (!(error instanceof TypeError) && error.name !== 'TimeoutError') throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Smoke API readiness failed.');
    const result = cp.spawnSync('pwsh', [
      '-NoProfile', '-File', path.join(__dirname, 'live.ps1'),
      '-BaseUrl', `http://127.0.0.1:${port}`,
    ], { cwd: ROOT, env: { ...process.env, SCIM_P5_SMOKE_SECRET: secret }, encoding: 'utf8' });
    const text = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    fs.mkdirSync(path.join(ROOT, 'test-results', 'p5'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'test-results', 'p5', 'live.log'), text);
    process.stdout.write(text);
    assert.equal(result.status, 0, 'Local live search section failed.');
  } finally {
    if (server.exitCode === null) {
      const closed = new Promise((resolve) => server.once('exit', resolve));
      server.kill();
      await closed;
    }
    process.stdout.write(`Stopped task-owned API process ${server.pid}.\n`);
  }
}
main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
