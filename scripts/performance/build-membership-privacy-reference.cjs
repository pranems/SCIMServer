const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

const parentImage = 'ghcr.io/pranems/scimserver@sha256:8b00fff083b8aae3226e9680ba987cc776bdb43d7a4ad8fc2812edf8019ecd4a';
const originalHash = '00ea9943fb8f6ecf296b34af5c9072d447b346d15b213669ba83d1f422f92c33';
const derivedHash = 'f558ea53e53492776ed88fc7f44ee36e30a2a706025703264ca071e6b3c68c24';
const target = 'app/dist/modules/prisma/prisma.service.js';
const oldWarning = "            console.warn(`[PrismaService] DATABASE_URL not set \u2013 using fallback '${fallback}'.`);";
const newWarning = "            console.warn('[PrismaService] DATABASE_URL not set - using local development fallback.');";
const startupPrefix = '        this.scimLogger?.info(log_levels_1.LogCategory.DATABASE, `Using database: ${process.env.DATABASE_URL || ';
const startupSourceHash = 'ad40cc22b94048846bba74f835d7b9be4e8a2101103118fd4bf4b95390d52416';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

function patchStatements(text, oldStartup) {
  const lines = text.split('\n');
  assert.equal(typeof oldStartup, 'string', 'Exact reviewed startup source');
  assert.ok(oldStartup.startsWith(startupPrefix), 'Exact reviewed startup prefix');
  assert.equal(lines.filter(line => line.startsWith(startupPrefix)).length, 1, 'Exact reviewed startup count');
  for (const statement of [oldWarning, oldStartup])
    assert.equal(lines.filter(line => line === statement).length, 1, 'Exact reviewed statement count');
  return lines.filter(line => line !== oldStartup)
    .map(line => line === oldWarning ? newWarning : line).join('\n');
}

function patchOriginal(bytes) {
  assert.equal(hash(bytes), originalHash, 'Exact original compiled hash');
  const text = bytes.toString('utf8');
  const startup = text.split('\n').find(line => line.startsWith(startupPrefix));
  assert.equal(hash(startup), startupSourceHash, 'Exact reviewed startup statement source hash');
  const result = Buffer.from(patchStatements(text, startup));
  assert.equal(hash(result), derivedHash, 'Exact reviewed derived hash');
  return result;
}

function readArchive(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length % 512 === 0, 'Complete tar framing');
  const entries = Object.create(null);
  const contents = new Map();
  const string = (header, start, length) => header.toString('utf8', start, start + length).split('\0')[0];
  function octal(header, start, length) {
    const text = string(header, start, length).trim();
    assert.match(text, /^[0-7]+$/, 'Supported unsigned tar octal');
    const value = Number.parseInt(text, 8);
    assert.ok(Number.isSafeInteger(value));
    return value;
  }
  let offset = 0;
  for (; offset + 512 <= bytes.length;) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every(value => value === 0)) {
      assert.ok(bytes.length - offset >= 1024 && bytes.subarray(offset).every(value => value === 0),
        'Complete zero tar terminator');
      return { entries, contents };
    }
    const sum = [...header].reduce((total, value, index) =>
      total + (index >= 148 && index < 156 ? 32 : value), 0);
    assert.equal(sum, octal(header, 148, 8), 'Tar checksum');
    const prefix = string(header, 345, 155);
    const name = `${prefix ? `${prefix}/` : ''}${string(header, 0, 100)}`.replace(/\/+$/, '');
    assert.ok(name === 'app' || name.startsWith('app/'), 'Only application archive paths');
    assert.equal(path.posix.normalize(name), name, 'No tar path traversal');
    assert.ok(!name.includes('\\') && !Object.hasOwn(entries, name), 'No ambiguous or duplicate tar path');
    const type = String.fromCharCode(header[156] || 48);
    assert.ok(['0', '2', '5'].includes(type), 'Unsupported tar entry type');
    const size = octal(header, 124, 12);
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    assert.ok(next <= bytes.length, 'Truncated tar entry');
    const entry = { type, mode: octal(header, 100, 8), uid: octal(header, 108, 8),
      gid: octal(header, 116, 8), size };
    if (type === '0') {
      const content = bytes.subarray(start, start + size);
      entry.sha256 = hash(content);
      contents.set(name, content);
    } else {
      assert.equal(size, 0, 'Nonfile tar content');
      if (type === '2') entry.link = string(header, 157, 100);
    }
    entries[name] = entry;
    offset = next;
  }
  assert.fail('Missing tar terminator');
}

function verifyDistribution(before, after) {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort(), 'Exact distribution path set');
  assert.equal(before[target]?.type, '0');
  assert.equal(before[target].sha256, originalHash);
  assert.equal(after[target]?.sha256, derivedHash, 'Only reviewed derived compiled bytes');
  for (const name of Object.keys(before)) {
    const candidate = name === target
      ? { ...after[name], size: before[name].size, sha256: before[name].sha256 } : after[name];
    assert.deepEqual(candidate, before[name], 'Unchanged file bytes, links, modes and ownership');
  }
  return { entries: Object.keys(before).length, changedFiles: 1, target,
    metadataCompared: ['type', 'mode', 'uid', 'gid', 'size', 'link', 'sha256'],
    timestampsCompared: false };
}

function safeCode(error) {
  return typeof error.code === 'string' && /^[A-Z_]+$/.test(error.code)
    ? error.code : 'REFERENCE_PREPARATION_FAILED';
}

function assertNoOnBuild(config) {
  if (!Object.hasOwn(config, 'OnBuild')) return 'absent';
  assert.ok(config.OnBuild === null || (Array.isArray(config.OnBuild) && config.OnBuild.length === 0),
    'No inherited build instructions');
  return config.OnBuild === null ? 'null' : 'empty-array';
}

function buildReference(sourceDirectory, outputDirectory) {
  const root = process.cwd();
  for (const directory of [sourceDirectory, outputDirectory]) {
    const relative = path.relative(root, path.resolve(directory));
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Worktree-local artifacts');
  }
  const git = args => execFileSync('git', args, { encoding: 'utf8', timeout: 10000 }).trim();
  assert.equal(git(['status', '--porcelain']), '', 'Commit tested source before build');
  git(['merge-base', '--is-ancestor', 'd25b6155bace7af2ec4ccb89f2eb0048e2db0c26', 'HEAD']);
  const sourceCommit = git(['rev-parse', 'HEAD']);
  const out = path.resolve(outputDirectory);
  fs.mkdirSync(out, { recursive: false });
  const started = Date.now();
  const capMs = 300000;
  const cleanupReserveMs = 45000;
  const owner = crypto.randomUUID();
  const name = `scim-derived-verify-${owner.slice(0, 12)}`;
  const tag = `scimserver-local:0.55.20-privacy-reference-derived-${owner.slice(0, 12)}`;
  const ownerLabel = 'scim.derived.owner';
  const commands = [];
  const report = { family: 'membership-privacy-derived-reference', derivedReference: true,
    diagnosticOnly: true, admissionEligible: false, runtimeQualified: false,
    baselineAdoptionApproved: false, status: 'INVALID', sourceCommit, parentImage, tag, owner, name,
    capMs, cleanupReserveMs, startedAt: new Date(started).toISOString(), commands };
  const write = (file, data) => fs.writeFileSync(path.join(out, file),
    JSON.stringify(data, null, 2), { flag: 'wx' });
  function timeout(cleanup = false, maximum = 30000) {
    const remaining = capMs - (Date.now() - started) - (cleanup ? 0 : cleanupReserveMs);
    assert.ok(remaining > 0, 'Fixed build/cleanup deadline');
    return Math.min(remaining, maximum);
  }
  function docker(args, cleanup = false) {
    commands.push(['docker', '--context', 'desktop-linux', ...args]);
    return execFileSync('docker', ['--context', 'desktop-linux', ...args], {
      encoding: 'utf8', timeout: timeout(cleanup), maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  }
  let phase = 'source-and-cache-preflight';
  let failure;
  try {
    const originalProof = JSON.parse(fs.readFileSync(path.join(sourceDirectory, 'proof.json')));
    assert.equal(originalProof.image, parentImage);
    assert.equal(originalProof.cleanupVerified, true);
    assert.equal(originalProof.state.status, 'created');
    assert.equal(originalProof.state.running, false);
    const archive = fs.readFileSync(path.join(sourceDirectory, 'app.tar'));
    assert.equal(hash(archive), originalProof.archiveSha256, 'Original extraction archive seal');
    const before = readArchive(archive);
    const original = before.contents.get(target);
    const corrected = patchOriginal(original);
    assert.equal(JSON.parse(before.contents.get('app/package.json')).version, '0.55.20');
    const image = JSON.parse(docker(['image', 'inspect', parentImage]))[0];
    assert.equal(image.Id, originalProof.platformImageId);
    assert.equal(`${image.Os}/${image.Architecture}`, 'linux/amd64');
    report.onBuildDeclaration = assertNoOnBuild(image.Config);
    assert.equal(docker(['image', 'ls', '--quiet', '--no-trunc', tag]), '', 'Unique never-overwritten tag');
    report.platformImageId = image.Id;
    report.platform = 'linux/amd64';
    report.imageNodeVersion = image.Config.Env.find(value => value.startsWith('NODE_VERSION='));
    report.dockerVersion = docker(['version', '--format', '{{.Server.Version}}']);
    report.buildxVersion = docker(['buildx', 'version']);
    report.hostNodeVersion = process.version;
    const sourceBytes = fs.readFileSync(__filename);
    const relativeFile = path.relative(root, __filename).split(path.sep).join('/');
    const gitBytes = execFileSync('git', ['show', `${sourceCommit}:${relativeFile}`], { timeout: 10000 });
    report.sourceBytes = { onDiskSha256: hash(sourceBytes), gitSha256: hash(gitBytes),
      rawEqual: sourceBytes.equals(gitBytes), newlineNormalizedEqual:
        sourceBytes.toString().replace(/\r\n/g, '\n') === gitBytes.toString().replace(/\r\n/g, '\n') };
    assert.equal(report.sourceBytes.newlineNormalizedEqual, true, 'Committed builder source');
    const context = path.join(out, 'context');
    fs.mkdirSync(context);
    fs.mkdirSync(path.join(out, 'frozen-inputs'));
    fs.writeFileSync(path.join(out, 'frozen-inputs', path.basename(__filename)), sourceBytes, { flag: 'wx' });
    const file = path.join(context, 'prisma.service.js');
    fs.writeFileSync(file, corrected, { flag: 'wx' });
    fs.utimesSync(file, 0, 0);
    const labels = { 'io.scimserver.reference.kind': 'DERIVED',
      'io.scimserver.reference.parent': parentImage, 'io.scimserver.reference.admission-eligible': 'false',
      'io.scimserver.reference.runtime-qualified': 'false',
      'io.scimserver.reference.source-commit': sourceCommit,
      'io.scimserver.reference.patch-sha256': derivedHash };
    const entry = before.entries[target];
    const recipe = [`FROM ${parentImage}`,
      ...Object.entries(labels).map(([key, value]) => `LABEL ${key}=${JSON.stringify(value)}`),
      `COPY --chown=${entry.uid}:${entry.gid} --chmod=0${entry.mode.toString(8)} prisma.service.js /${target}`, ''].join('\n');
    fs.writeFileSync(path.join(context, 'Dockerfile'), recipe, { flag: 'wx' });
    fs.utimesSync(path.join(context, 'Dockerfile'), 0, 0);
    const buildArgs = ['build', '--pull=false', '--network=none', '--provenance=false', '--sbom=false',
      '--build-arg', 'SOURCE_DATE_EPOCH=0', '--iidfile', path.join(out, 'image-id.txt'),
      '--tag', tag, '--file', path.join(context, 'Dockerfile'), context];
    write('manifest.json', { ...report, status: 'FROZEN_BEFORE_BUILD', originalHash, derivedHash,
      originalArchiveSha256: originalProof.archiveSha256, sourceProofSha256:
        hash(fs.readFileSync(path.join(sourceDirectory, 'proof.json'))),
      recipeSha256: hash(Buffer.from(recipe)), labels, buildCommand: ['docker', '--context', 'desktop-linux', ...buildArgs],
      deterministicInputs: { sourceDateEpoch: 0, copiedFileMtime: 0, uniqueTagDoesNotEnterImageConfig: true } });
    write('original-distribution.json', before.entries);
    phase = 'single-offline-build';
    commands.push(['docker', '--context', 'desktop-linux', ...buildArgs]);
    const built = spawnSync('docker', ['--context', 'desktop-linux', ...buildArgs], {
      encoding: 'utf8', timeout: timeout(false, 240000), maxBuffer: 1024 * 1024,
      env: { ...process.env, DOCKER_BUILDKIT: '1', BUILDX_NO_DEFAULT_ATTESTATIONS: '1' },
    });
    fs.writeFileSync(path.join(out, 'build.log'), (built.stdout || '') + (built.stderr || ''), { flag: 'wx' });
    if (built.error) throw built.error;
    assert.equal(built.status, 0, 'Sole offline build must succeed');
    phase = 'unstarted-image-verification';
    const derived = JSON.parse(docker(['image', 'inspect', tag]))[0];
    report.derivedImageId = derived.Id;
    assert.equal(Date.parse(derived.Created), 0, 'Fixed image creation epoch applied');
    report.deterministicControlsApplied = true;
    report.repeatedBuildCompared = false;
    assert.equal(derived.Id, fs.readFileSync(path.join(out, 'image-id.txt'), 'utf8').trim());
    assert.equal(`${derived.Os}/${derived.Architecture}`, report.platform);
    assert.deepEqual(derived.RootFS.Layers.slice(0, -1), image.RootFS.Layers, 'Exact inherited runtime layers');
    assert.equal(derived.RootFS.Layers.length, image.RootFS.Layers.length + 1);
    assert.deepEqual(derived.Config.Labels, { ...image.Config.Labels, ...labels }, 'Only declared derived labels');
    assert.deepEqual({ ...derived.Config, Labels: null }, { ...image.Config, Labels: null },
      'All nonlabel runtime configuration unchanged');
    report.runtimeConfigEqualExceptLabels = true;
    report.inheritedLayersIdentical = true;
    const id = docker(['create', '--pull=never', '--network', 'none', '--name', name,
      '--label', `${ownerLabel}=${owner}`, '--entrypoint', '/bin/false', tag]);
    const checkState = () => {
      const info = JSON.parse(docker(['inspect', id]))[0];
      assert.equal(info.Config.Labels[ownerLabel], owner);
      assert.equal(info.Image, derived.Id);
      assert.equal(info.State.Status, 'created');
      assert.equal(info.State.Running, false);
      assert.equal(info.State.StartedAt, '0001-01-01T00:00:00Z');
    };
    checkState();
    const archiveFile = path.join(out, 'derived-app.tar');
    const fd = fs.openSync(archiveFile, 'wx');
    let captured;
    try {
      commands.push(['docker', '--context', 'desktop-linux', 'cp', `${id}:/app`, '-']);
      captured = spawnSync('docker', ['--context', 'desktop-linux', 'cp', `${id}:/app`, '-'],
        { stdio: ['ignore', fd, 'pipe'], timeout: timeout(false, 90000), maxBuffer: 65536 });
    } finally { fs.closeSync(fd); }
    if (captured.error) throw captured.error;
    assert.equal(captured.status, 0, 'Unstarted full application capture');
    checkState();
    const derivedArchive = fs.readFileSync(archiveFile);
    const after = readArchive(derivedArchive);
    report.distribution = verifyDistribution(before.entries, after.entries);
    assert.equal(JSON.parse(after.contents.get('app/package.json')).version, '0.55.20');
    report.applicationReportedVersionUnchanged = '0.55.20';
    report.derivedArchiveSha256 = hash(derivedArchive);
    report.compiledBeforeSha256 = hash(original);
    report.compiledAfterSha256 = hash(after.contents.get(target));
    write('derived-distribution.json', after.entries);
    report.status = 'DERIVED_BUILD_VERIFIED';
  } catch (error) { failure = error; report.failure = { phase, code: safeCode(error) }; }
  report.cleanup = { verified: false };
  try {
    const found = docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], true);
    if (found) {
      const info = JSON.parse(docker(['inspect', found], true))[0];
      assert.equal(info.Config.Labels[ownerLabel], owner, 'Cleanup owner');
      assert.equal(info.State.Running, false, 'Never stop a running application');
      docker(['rm', '--volumes', info.Id], true);
    }
    report.cleanup.verified = docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.ID}}'], true) === '';
    assert.equal(report.cleanup.verified, true, 'Owned source container absent');
  } catch (error) { failure ||= error; report.cleanup.failureCode = safeCode(error); }
  report.elapsedMs = Date.now() - started;
  if (failure || report.elapsedMs > capMs) report.status = 'INVALID';
  write('receipt.json', report);
  console.log(JSON.stringify({ status: report.status, tag, imageId: report.derivedImageId,
    elapsedMs: report.elapsedMs, cleanup: report.cleanup, failure: report.failure }));
  return report;
}

module.exports = { parentImage, target, originalHash, derivedHash, oldWarning, startupPrefix, newWarning,
  patchStatements, patchOriginal, readArchive, verifyDistribution, assertNoOnBuild, buildReference };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--build-derived-reference') {
    console.error('Explicit offline derived-reference opt-in and source/output directories required');
    process.exitCode = 1;
  } else {
    try {
      const result = buildReference(args[1], args[2]);
      if (result.status !== 'DERIVED_BUILD_VERIFIED') process.exitCode = 1;
    } catch (error) {
      console.error(`Offline derived-reference preparation rejected: ${safeCode(error)}`);
      process.exitCode = 1;
    }
  }
}
