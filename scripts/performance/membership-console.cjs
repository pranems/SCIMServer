const assert = require('node:assert/strict');
const { validateCanaries, assertCanariesAbsent, lifecycleFailure } = require('./membership-privacy.cjs');
const { matchesPatchRecord } = require('./membership-history.cjs');
const limits = Object.freeze({ totalBytes: 64 * 1024 * 1024, frameBytes: 65536, chunkBytes: 65536,
  records: 1000000, canaries: 8, canaryBytes: 256, closeReserveMs: 100, toolBytes: 8 * 1024 * 1024 });
const proven = new WeakMap();
const frame = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z /;
const roles = ['reference-app', 'candidate-app', 'pg'];
const issue = code => Object.assign(Error('Complete console capture rejected; private output withheld'), { code });

function requireCapture(receipt, { role, source, canaries, correlationRequestId }) {
  validateCanaries(canaries);
  assert.ok(proven.has(receipt), 'Live complete capture proof required');
  const input = proven.get(receipt);
  assert.ok(canaries.every((row, index) => row.kind === input.canaries[index]?.kind &&
    row.value === input.canaries[index]?.value) && canaries.length === input.canaries.length,
  'Matching capture canary inputs required');
  assert.equal(receipt.role, role);
  assert.equal(receipt.source, source);
  assert.deepEqual(receipt.credentialKinds, canaries.map(row => row.kind));
  assert.equal(receipt.correlationRequired, !!correlationRequestId);
  assert.equal(input.correlationRequestId, correlationRequestId);
  if (correlationRequestId) assert.equal(receipt.correlationPresent, true);
  return receipt;
}

async function captureChild(child, options) {
  const { role, source, phase, canaries, deadline, correlationRequestId } = options;
  const started = Date.now();
  let first;
  let finished = false;
  let totalBytes = 0;
  let records = 0;
  let framedRecords = 0;
  let ambiguousRecords = 0;
  let containerPresent = false;
  let correlationPresent = false;
  const states = [];
  let rawCombined = Buffer.alloc(0);
  let payloadCombined = Buffer.alloc(0);
  let tailBytes = 0;
  const context = { operation: 'capture', role, stage: 'docker-command',
    phase, command: 'logs' };
  function failure(error) {
    if (first) return;
    const original = error?.code === 'DIAGNOSTIC_PRIVACY' ? error :
      Object.assign(Error('Complete console capture failed; private output withheld'), { code: 'OWNED_DOCKER' });
    original.actionFailure = lifecycleFailure(error, { ...context, durationMs: Date.now() - started });
    first = original;
    child.kill('SIGKILL');
  }
  function scan(previous, bytes, origin) {
    const joined = Buffer.concat([previous, bytes]);
    for (const canary of canaries)
      if (joined.includes(Buffer.from(canary.value))) {
        assertCanariesAbsent([{ source: origin, text: canary.value }], [canary]);
      }
    return Buffer.from(joined.subarray(Math.max(0, joined.length - tailBytes)));
  }
  function record(state) {
    const bytes = state.frame.subarray(0, state.bytes);
    state.bytes = 0;
    if (++records > limits.records) throw issue('CAPTURE_RECORD_LIMIT');
    const prefix = frame.exec(bytes.subarray(0, 40).toString('ascii'));
    const payload = prefix ? bytes.subarray(prefix[0].length) : bytes;
    const origin = prefix ? source : 'ambiguous-console';
    if (prefix) {
      framedRecords++;
      if (payload.toString('utf8').trim()) containerPresent = true;
    } else ambiguousRecords++;
    state.payloadTail = scan(state.payloadTail, payload, origin);
    payloadCombined = scan(payloadCombined, payload, 'ambiguous-console');
    const other = states.find(item => item !== state);
    if (other) {
      scan(state.payloadTail, other.payloadTail, 'ambiguous-console');
      scan(other.payloadTail, state.payloadTail, 'ambiguous-console');
    }
    if (prefix && correlationRequestId &&
        matchesPatchRecord(payload.toString('utf8'), correlationRequestId)) correlationPresent = true;
  }
  function consume(state, chunk) {
    if (first || finished) return;
    try {
      totalBytes += chunk.length;
      if (totalBytes > limits.totalBytes) throw issue('CAPTURE_TOTAL_LIMIT');
      if (chunk.length > limits.chunkBytes) throw issue('CAPTURE_FRAME_LIMIT');
      let offset = 0;
      while (offset < chunk.length) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        const part = chunk.subarray(offset, end);
        if (state.bytes + part.length > limits.frameBytes) throw issue('CAPTURE_FRAME_LIMIT');
        part.copy(state.frame, state.bytes);
        state.bytes += part.length;
        if (newline >= 0) record(state);
        offset = end + 1;
      }
      // Unfinished or cross-channel text cannot be attributed to a container record.
      state.rawTail = scan(state.rawTail, chunk, 'ambiguous-console');
      rawCombined = scan(rawCombined, chunk, 'ambiguous-console');
    } catch (error) { failure(error); }
  }
  return new Promise((resolve, reject) => {
    let timer;
    let hardTimer;
    function finish(code, signal) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(hardTimer);
      if (!first) {
        try {
          if (Date.now() > deadline) throw issue('ETIMEDOUT');
          if (code !== 0 || signal) throw Object.assign(issue(code), { signal });
          if (states.length !== 2 || states.some(state => !state.eof || state.bytes))
            throw issue('CAPTURE_INCOMPLETE');
          if (!containerPresent) throw issue('CAPTURE_EMPTY');
          if (correlationRequestId && !correlationPresent) throw issue('CAPTURE_CORRELATION');
        } catch (error) { failure(error); }
      }
      for (const state of states) {
        state.frame = Buffer.alloc(0);
        state.rawTail = state.payloadTail = Buffer.alloc(0);
        state.stream.removeListener('data', state.onData);
      }
      rawCombined = payloadCombined = Buffer.alloc(0);
      if (first) return reject(first);
      const receipt = Object.freeze({ complete: true, diagnosticOnly: true, role, source, phase,
        startedAtUtc: new Date(started).toISOString(), finishedAtUtc: new Date().toISOString(),
        durationMs: Date.now() - started,
        exitCode: 0, signal: null, stdoutEof: true, stderrEof: true,
        totalBytes, framedRecords, ambiguousRecords,
        attribution: 'timestamp-framed-container; unframed-or-cross-channel-ambiguous',
        credentialKinds: Object.freeze(canaries.map(row => row.kind)),
        correlationRequired: !!correlationRequestId, correlationPresent: correlationRequestId ? correlationPresent : null,
        limits });
      proven.set(receipt, { canaries: canaries.map(row => ({ ...row })), correlationRequestId });
      resolve(receipt);
    }
    child.once('error', error => failure(error));
    child.once('close', finish);
    try {
      validateCanaries(canaries);
      assert.ok(canaries.length <= limits.canaries);
      assert.ok(canaries.every(row => Buffer.byteLength(row.value) <= limits.canaryBytes));
      assert.ok(roles.includes(role) && ['app-console', 'pg-console'].includes(source));
      assert.equal(source === 'pg-console', role === 'pg');
      assert.ok(['work', 'cleanup'].includes(phase));
      assert.ok(Number.isSafeInteger(deadline) && deadline > Date.now(), 'Unexpired capture deadline');
      if (correlationRequestId) {
        assert.equal(role, 'candidate-app');
        assert.match(correlationRequestId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i);
      }
      tailBytes = Math.max(...canaries.map(row => Buffer.byteLength(row.value))) - 1;
      for (const stream of [child.stdout, child.stderr]) {
        if (!stream || typeof stream.on !== 'function') throw issue('CAPTURE_CHANNEL');
        const state = { stream, frame: Buffer.alloc(limits.frameBytes), bytes: 0, eof: false,
          rawTail: Buffer.alloc(0), payloadTail: Buffer.alloc(0) };
        state.onData = chunk => consume(state, chunk);
        states.push(state);
        stream.on('data', state.onData);
        stream.once('end', () => { state.eof = true; });
        stream.once('error', error => failure(error));
      }
    } catch (error) { failure(error); }
    const remaining = Math.max(1, deadline - Date.now());
    timer = setTimeout(() => failure(issue('ETIMEDOUT')), Math.max(1, remaining - limits.closeReserveMs));
    hardTimer = setTimeout(() => { failure(issue('ETIMEDOUT')); finish(null, null); }, remaining);
  });
}

module.exports = { limits, captureChild, requireCapture };
