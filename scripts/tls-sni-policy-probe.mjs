/**
 * TLS per-endpoint policy feasibility probe.
 *
 * Question: can one process serve two logical SCIM endpoints where one accepts
 * only TLS 1.3 and the other also accepts TLS 1.2?
 *
 * This script measures two candidate mechanisms, each with a NEGATIVE CONTROL so
 * the probe itself is proven before its output is believed (house norm: a new
 * checking tool needs its own sanity check first).
 *
 *   Mechanism A - one tls.Server plus server.addContext(host, secureContext)
 *                 where the per-host context carries its own minVersion.
 *   Mechanism B - a net.Server that peeks the ClientHello for SNI and hands the
 *                 raw socket to one of N dedicated tls.Server instances, each
 *                 constructed with its own minVersion.
 *
 * Usage:
 *   node scripts/tls-sni-policy-probe.mjs
 *   node scripts/tls-sni-policy-probe.mjs --key path/key.pem --cert path/cert.pem
 *
 * With no key/cert supplied, a throwaway self-signed pair is generated into the
 * OS temp directory using openssl (PATH, or the Git for Windows bundled copy).
 *
 * Exit code: 0 if both negative controls passed (probe is trustworthy), 1 if a
 * control failed (probe output must NOT be believed).
 */
import net from 'node:net';
import tls from 'node:tls';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HOST_STRICT = 'tls13.probe.local';
const HOST_RELAXED = 'tls12.probe.local';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--key') out.key = argv[i + 1];
    if (argv[i] === '--cert') out.cert = argv[i + 1];
  }
  return out;
}

function findOpenssl() {
  const candidates = [
    'openssl',
    'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
    '/usr/bin/openssl',
  ];
  for (const c of candidates) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' });
      return c;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function ensureCert(args) {
  if (args.key && args.cert) {
    return { key: fs.readFileSync(args.key), cert: fs.readFileSync(args.cert) };
  }
  const openssl = findOpenssl();
  if (!openssl) {
    console.error(
      'No openssl found and no --key/--cert supplied. Provide a throwaway pair explicitly.',
    );
    process.exit(1);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tls-probe-'));
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  execFileSync(
    openssl,
    [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-subj', '/CN=localhost',
      '-addext', `subjectAltName=DNS:localhost,DNS:${HOST_STRICT},DNS:${HOST_RELAXED}`,
      '-keyout', keyPath, '-out', certPath,
    ],
    { stdio: 'ignore' },
  );
  return { key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

/** Minimal ClientHello SNI extractor. Returns the hostname, or null. */
export function parseSni(buf) {
  try {
    if (buf.length < 43 || buf[0] !== 0x16) return null; // not a TLS handshake record
    let p = 5;
    if (buf[p] !== 0x01) return null; // not client_hello
    p += 4;   // handshake type (1) + length (3)
    p += 2;   // client_version
    p += 32;  // random
    p += 1 + buf[p];                  // session_id
    p += 2 + buf.readUInt16BE(p);     // cipher_suites
    p += 1 + buf[p];                  // compression_methods
    if (p + 2 > buf.length) return null;
    const extEnd = p + 2 + buf.readUInt16BE(p);
    p += 2;
    while (p + 4 <= extEnd && p + 4 <= buf.length) {
      const type = buf.readUInt16BE(p);
      const len = buf.readUInt16BE(p + 2);
      const body = p + 4;
      if (type === 0x0000) {
        // server_name_list_length(2) name_type(1) name_length(2) name
        const nameLen = buf.readUInt16BE(body + 3);
        return buf.toString('utf8', body + 5, body + 5 + nameLen);
      }
      p = body + len;
    }
    return null;
  } catch {
    return null;
  }
}

/** Attempt one handshake. Resolves with the negotiated protocol or the error code. */
function probe(port, servername, maxVersion) {
  return new Promise((resolve) => {
    const sock = tls.connect(
      { port, host: '127.0.0.1', servername, maxVersion, rejectUnauthorized: false },
      () => {
        const protocol = sock.getProtocol();
        sock.destroy();
        resolve({ ok: true, protocol });
      },
    );
    sock.on('error', (err) => {
      sock.destroy();
      resolve({ ok: false, error: err.code || err.message });
    });
    sock.setTimeout(5000, () => {
      sock.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
  });
}

const results = [];
function record(mechanism, scenario, expectation, observed, verdict, isControl) {
  results.push({ mechanism, scenario, expectation, observed, verdict, isControl });
}

async function mechanismA({ key, cert }) {
  const server = tls.createServer({ key, cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' });
  server.addContext(
    HOST_STRICT,
    tls.createSecureContext({ key, cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' }),
  );
  server.addContext(
    HOST_RELAXED,
    tls.createSecureContext({ key, cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' }),
  );
  server.on('secureConnection', (s) => s.end());
  server.on('tlsClientError', () => {});

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const M = 'A: one tls.Server + addContext per SNI host';

  const control = await probe(port, HOST_RELAXED, 'TLSv1.2');
  record(
    M,
    `${HOST_RELAXED}, client max TLSv1.2`,
    'accept at TLSv1.2',
    control.ok ? `accepted ${control.protocol}` : `rejected ${control.error}`,
    control.ok && control.protocol === 'TLSv1.2' ? 'CONTROL OK' : 'CONTROL BROKEN',
    true,
  );

  const subject = await probe(port, HOST_STRICT, 'TLSv1.2');
  record(
    M,
    `${HOST_STRICT} whose context sets minVersion TLSv1.3, client max TLSv1.2`,
    'reject, if the per-SNI minVersion is honoured',
    subject.ok ? `accepted ${subject.protocol}` : `rejected ${subject.error}`,
    subject.ok ? 'PER-SNI minVersion IGNORED' : 'PER-SNI minVersion HONOURED',
    false,
  );

  const sanity = await probe(port, HOST_STRICT, 'TLSv1.3');
  record(
    M,
    `${HOST_STRICT}, client max TLSv1.3`,
    'accept at TLSv1.3',
    sanity.ok ? `accepted ${sanity.protocol}` : `rejected ${sanity.error}`,
    sanity.ok && sanity.protocol === 'TLSv1.3' ? 'OK' : 'UNEXPECTED',
    false,
  );

  await new Promise((r) => server.close(r));
}

async function mechanismB({ key, cert }) {
  const strict = tls.createServer({ key, cert, minVersion: 'TLSv1.3', maxVersion: 'TLSv1.3' });
  const relaxed = tls.createServer({ key, cert, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.3' });
  for (const s of [strict, relaxed]) {
    s.on('secureConnection', (sock) => sock.end());
    s.on('tlsClientError', () => {});
  }

  const router = net.createServer((socket) => {
    socket.once('readable', () => {
      const chunk = socket.read() || Buffer.alloc(0);
      const sni = parseSni(chunk);
      socket.unshift(chunk);
      const target = sni === HOST_STRICT ? strict : relaxed;
      target.emit('connection', socket);
    });
    socket.on('error', () => socket.destroy());
  });

  await new Promise((r) => router.listen(0, '127.0.0.1', r));
  const { port } = router.address();
  const M = 'B: SNI router + one tls.Server per policy';

  const control = await probe(port, HOST_RELAXED, 'TLSv1.2');
  record(
    M,
    `${HOST_RELAXED}, client max TLSv1.2`,
    'accept at TLSv1.2',
    control.ok ? `accepted ${control.protocol}` : `rejected ${control.error}`,
    control.ok && control.protocol === 'TLSv1.2' ? 'CONTROL OK' : 'CONTROL BROKEN',
    true,
  );

  const subject = await probe(port, HOST_STRICT, 'TLSv1.2');
  record(
    M,
    `${HOST_STRICT} routed to the 1.3-only listener, client max TLSv1.2`,
    'reject during the handshake',
    subject.ok ? `accepted ${subject.protocol}` : `rejected ${subject.error}`,
    subject.ok ? 'NOT ENFORCED' : 'ENFORCED AT HANDSHAKE',
    false,
  );

  const sanity = await probe(port, HOST_STRICT, 'TLSv1.3');
  record(
    M,
    `${HOST_STRICT}, client max TLSv1.3`,
    'accept at TLSv1.3',
    sanity.ok ? `accepted ${sanity.protocol}` : `rejected ${sanity.error}`,
    sanity.ok && sanity.protocol === 'TLSv1.3' ? 'OK' : 'UNEXPECTED',
    false,
  );

  await new Promise((r) => router.close(r));
  strict.close();
  relaxed.close();
}

const material = ensureCert(parseArgs(process.argv.slice(2)));
await mechanismA(material);
await mechanismB(material);

console.log('\n=== TLS per-endpoint policy feasibility probe ===');
console.log(`node ${process.version} / openssl ${process.versions.openssl}\n`);
for (const r of results) {
  console.log(`[${r.verdict}]${r.isControl ? ' (negative control)' : ''}`);
  console.log(`  mechanism : ${r.mechanism}`);
  console.log(`  scenario  : ${r.scenario}`);
  console.log(`  expected  : ${r.expectation}`);
  console.log(`  observed  : ${r.observed}\n`);
}

const controlsOk = results.filter((r) => r.isControl).every((r) => r.verdict === 'CONTROL OK');
if (!controlsOk) {
  console.error('A negative control FAILED. Do not believe the rest of this output.');
  process.exit(1);
}
console.log('Both negative controls passed, so the measurements above are trustworthy.');
