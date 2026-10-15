import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const script = fileURLToPath(new URL('./check-lockfile-provenance.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'root-provenance-'));
let failures = 0;
try {
  for (const [label, entry, expected] of [
    ['public sha512 root', { resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
      integrity: 'sha512-YQ==' }, 0],
    ['internal root URL', { resolved: 'https://internal.invalid/example.tgz', integrity: 'sha512-YQ==' }, 1],
    ['weak root integrity', { resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz',
      integrity: 'sha1-YQ==' }, 1],
    ['missing root integrity', { resolved: 'https://registry.npmjs.org/example/-/example-1.0.0.tgz' }, 1],
  ]) {
    writeFileSync(join(scratch, 'package-lock.json'), JSON.stringify({
      packages: { '': {}, 'node_modules/example': { version: '1.0.0', ...entry } },
    }));
    const result = spawnSync(process.execPath, [script], { cwd: scratch, encoding: 'utf8' });
    try {
      assert.equal(result.status, expected, result.stdout + result.stderr);
      console.log(`PASS: ${label} returns ${expected}`);
    } catch (error) {
      failures++;
      console.error(`FAIL: ${label}: ${error.message}`);
    }
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exitCode = failures ? 1 : 0;
