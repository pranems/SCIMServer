const assert = require('node:assert/strict');
const { StringDecoder } = require('node:string_decoder');
const { lifecycleFailure } = require('./membership-privacy.cjs');
const { collect, validateSnapshot } = require('./membership-history.cjs');
const maximumFrame = 65536;
const snapshotKeys = ['epoch', 'pid', 'startTicks', 'readStartUtc', 'readStartNs',
  'cpu', 'cpuStatRaw', 'cpuMax', 'cpuBurst', 'ancestors', 'rssBytes',
  'highWaterRssBytes', 'memoryPeakBytes', 'memoryMaxBytes', 'oom', 'oomKill',
  'readEndUtc', 'readEndNs'].sort();

function validateObservedSnapshot(value) {
  assert.deepEqual(Object.keys(value).sort(), snapshotKeys);
  validateSnapshot(value);
  assert.equal(value.memoryMaxBytes, 1073741824);
  assert.deepEqual(Object.keys(value.cpu).sort(),
    ['nr_periods', 'nr_throttled', 'throttled_usec', 'usage_usec']);
  assert.match(value.cpuStatRaw, /^[a-z_.]+ \d+(?:\n[a-z_.]+ \d+)*$/);
  for (const ancestor of value.ancestors)
    assert.deepEqual(Object.keys(ancestor).sort(), ['cpuBurst', 'cpuMax', 'path', 'root']);
}

function serve(owner, capture = collect) {
  assert.match(owner, /^[a-f0-9]{32}$/);
  const decoder = new StringDecoder('utf8');
  const targets = new Map();
  const seen = new Set();
  let buffer = '';
  let failed = false;
  function reject() {
    if (failed) return;
    failed = true;
    process.exitCode = 1;
    process.stdout.write('{"requestId":0,"ok":false,"error":"protocol-error"}\n');
    process.stdin.destroy();
  }
  function drain() {
    if (failed) return;
    try {
      assert.ok(Buffer.byteLength(buffer) <= 4096, 'Request frame limit');
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const frame = JSON.parse(line);
        assert.equal(frame.owner, owner);
        assert.ok(Number.isSafeInteger(frame.requestId) && frame.requestId > 0);
        assert.ok(!seen.has(frame.requestId) && seen.size < 1024);
        seen.add(frame.requestId);
        assert.match(frame.id, /^[a-f0-9]{64}$/);
        assert.ok(['bind', 'snapshot'].includes(frame.kind));
        assert.deepEqual(Object.keys(frame).sort(),
          (frame.kind === 'bind' ? ['kind', 'id', 'pid', 'owner', 'requestId'] :
            ['kind', 'id', 'owner', 'requestId']).sort());
        if (frame.kind === 'bind') {
          assert.match(frame.pid, /^[1-9]\d*$/);
          assert.ok(targets.size < 32);
        } else assert.ok(targets.has(frame.id));
        const pid = frame.kind === 'bind' ? frame.pid : targets.get(frame.id).pid;
        let snapshot;
        let changed = false;
        try { snapshot = capture(pid, frame.id); }
        catch (error) {
          if (frame.kind !== 'snapshot' || error.code !== 'ENOENT' ||
              require('node:fs').existsSync(`/proc/${pid}/stat`)) throw error;
          changed = true;
        }
        if (changed || (frame.kind === 'snapshot' &&
            snapshot.epoch !== targets.get(frame.id).epoch)) {
          targets.delete(frame.id);
          process.stdout.write(JSON.stringify({ requestId: frame.requestId,
            ok: false, error: 'target-epoch-changed' }) + '\n');
          continue;
        }
        validateObservedSnapshot(snapshot);
        assert.match(snapshot.epoch, new RegExp(`^${frame.id}:${pid}:\\d+$`));
        if (frame.kind === 'snapshot')
          assert.equal(snapshot.epoch, targets.get(frame.id).epoch, 'Target lifetime changed');
        else targets.set(frame.id, { pid, epoch: snapshot.epoch });
        const reply = JSON.stringify({ requestId: frame.requestId, ok: true, snapshot }) + '\n';
        assert.ok(Buffer.byteLength(reply) <= maximumFrame);
        if (!process.stdout.write(reply)) {
          process.stdin.pause();
          process.stdout.once('drain', () => { process.stdin.resume(); drain(); });
          return;
        }
      }
    } catch { reject(); }
  }
  process.stdin.on('data', bytes => {
    buffer += decoder.write(bytes);
    drain();
  });
  process.stdin.on('end', () => {
    buffer += decoder.end();
    if (buffer.length) reject();
  });
  process.stdin.on('error', reject);
}

class ObserverChannel {
  constructor(child, owner, timeoutMs = 2000) {
    assert.match(owner, /^[a-f0-9]{32}$/);
    assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
    this.child = child;
    this.owner = owner;
    this.timeoutMs = timeoutMs;
    this.sequence = 0;
    this.buffer = '';
    this.decoder = new StringDecoder('utf8');
    this.closed = new Promise(resolve => {
      child.once('close', (code, signal) => {
        this.exited = true;
        if (this.pending) this.fail('Observer EOF before reply');
        resolve({ code, signal });
      });
    });
    child.on('error', error => this.fail('Observer child startup failure', error));
    child.stdin.on('error', error => this.fail('Observer input closed', error));
    child.stderr.on('data', bytes => {
      this.stderrBytes = Math.min(1025, (this.stderrBytes || 0) + bytes.length);
      this.fail('Observer stderr rejected; content withheld');
    });
    child.stdout.on('data', bytes => {
      this.buffer += this.decoder.write(bytes);
      try {
        assert.ok(Buffer.byteLength(this.buffer) <= maximumFrame);
        let newline;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          const reply = JSON.parse(line);
          assert.equal(this.buffer.length, 0, 'Only one framed reply per outstanding request');
          assert.ok(this.pending, 'Unsolicited or duplicate reply');
          assert.equal(reply.requestId, this.pending.id);
          if (reply.ok === false) {
            assert.deepEqual(Object.keys(reply).sort(), ['error', 'ok', 'requestId']);
            assert.equal(reply.error, 'target-epoch-changed');
            const pending = this.pending;
            this.pending = null;
            clearTimeout(pending.timer);
            pending.reject(new Error('Observer target epoch changed'));
            continue;
          }
          assert.deepEqual(Object.keys(reply).sort(), ['ok', 'requestId', 'snapshot']);
          assert.equal(reply.ok, true);
          validateObservedSnapshot(reply.snapshot);
          const pending = this.pending;
          this.pending = null;
          clearTimeout(pending.timer);
          pending.resolve(reply.snapshot);
        }
      } catch { this.fail('Observer reply rejected'); }
    });
    child.stdout.on('end', () => {
      if (this.pending || this.buffer.length) this.fail('Observer EOF before reply');
    });
  }

  fail(message, cause) {
    if (!this.failure) {
      this.failure = new Error(message);
      if (cause) this.failure.actionFailure = lifecycleFailure(cause, {
        operation: 'command', role: 'observer', stage: 'native-command', phase: 'work',
        command: 'observer-exec' });
    }
    this.buffer = '';
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(this.failure);
      this.pending = null;
    }
    if (!this.exited) this.child.kill();
  }

  async request(frame) {
    assert.ok(!this.pending, 'Only one outstanding observer request');
    if (this.failure) throw this.failure;
    assert.ok(!this.exited && !this.closing, 'Observer EOF or closed channel');
    const id = ++this.sequence;
    const line = JSON.stringify({ ...frame, owner: this.owner, requestId: id }) + '\n';
    assert.ok(Buffer.byteLength(line) <= 4096);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Observer request timeout'), this.timeoutMs);
      this.pending = { id, resolve, reject, timer };
      this.child.stdin.write(line, error => {
        if (error) this.fail('Observer write failed', error);
      });
    });
  }

  async close() {
    this.closing = true;
    if (this.pending) this.fail('Observer closed with pending request');
    this.child.stdin.end();
    const timer = setTimeout(() => this.fail('Observer close timeout'), 1000);
    try { return await this.closed; }
    finally { clearTimeout(timer); }
  }
}

module.exports = { ObserverChannel, serve };
if (require.main === module) {
  assert.equal(process.argv[2], '--serve', 'Explicit owned observer stream required');
  assert.equal(process.argv.length, 4);
  serve(process.argv[3]);
}
