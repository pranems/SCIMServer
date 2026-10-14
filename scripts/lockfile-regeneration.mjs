import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function workspaces(selection) {
  const choices = { root: ['.'], api: ['api'], web: ['web'], both: ['api', 'web'] };
  if (!Object.hasOwn(choices, selection)) throw new Error(`Unknown workspace: ${selection}`);
  return choices[selection];
}

function packages(lock) {
  if (!lock.packages || typeof lock.packages !== 'object') throw new Error('Lockfile packages map is missing');
  return lock.packages;
}

export function verifyLockfile(lock) {
  for (const [path, entry] of Object.entries(packages(lock))) {
    if (!path || entry.link) continue;
    if (!entry.resolved || !/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved)) {
      throw new Error(`${path}: resolved must use https://registry.npmjs.org/`);
    }
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity ?? '')) {
      throw new Error(`${path}: integrity must be sha512`);
    }
  }
}

export function changedPackages(before, after) {
  const previous = packages(before);
  return Object.entries(packages(after)).flatMap(([path, entry]) => {
    if (!path.includes('node_modules/') || !entry.version ||
        JSON.stringify(previous[path]) === JSON.stringify(entry)) return [];
    return [{ name: path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length),
      before: previous[path]?.version ?? '(new)', version: entry.version }];
  });
}

export function releaseAge(published, now = Date.now()) {
  const timestamp = Date.parse(published);
  if (!Number.isFinite(timestamp)) throw new Error('Publication time is unknown');
  const days = (now - timestamp) / 86_400_000;
  if (days < 7) throw new Error(`Publication age ${days.toFixed(2)} is below 7 days`);
  return days;
}

export function seedManifest(manifest, lock) {
  const baseline = packages(lock);
  const devDependencies = { ...manifest.devDependencies };
  for (const [path, entry] of Object.entries(baseline)) {
    const match = path.match(/^node_modules\/(@[^/]+\/[^/]+|[^/]+)$/);
    if (!match || !entry.version || entry.link) continue;
    const name = match[1];
    if (Object.hasOwn(manifest.dependencies ?? {}, name)) continue;
    if (Object.hasOwn(devDependencies, name) &&
        manifest.devDependencies[name] !== baseline['']?.devDependencies?.[name]) continue;
    devDependencies[name] = entry.version;
  }
  return { ...manifest, devDependencies };
}

function regenerateRoot() {
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Root lockfile generation is CI only');
  if (process.platform !== 'linux') throw new Error('Root lockfile generation requires the existing Linux CI runner');
  const original = readFileSync('package.json', 'utf8');
  const manifest = JSON.parse(original);
  const baseline = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const args = ['install', '--package-lock-only', '--no-audit', '--no-fund', '--ignore-scripts', `--before=${cutoff}`];
  // Seed exact existing versions in a temporary manifest. npm resolves new
  // requirements, then prunes temporary direct entries using the real manifest.
  try {
    writeFileSync('package.json', JSON.stringify(seedManifest(manifest, baseline), null, 2) + '\n');
    unlinkSync('package-lock.json');
    execFileSync('npm', args, { stdio: 'inherit' });
  } finally {
    writeFileSync('package.json', original);
  }
  execFileSync('npm', args, { stdio: 'inherit' });
}

function npmView(name, version) {
  const args = ['view', `${name}@${version}`, 'time', '--json'];
  const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] };
  // npm is a .cmd on Windows. Package identities come from the lockfile,
  // never pass shell metacharacters to cmd.exe.
  if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(name) || !/^[a-z0-9.+-]+$/i.test(version)) {
    throw new Error(`Invalid package identity: ${name}@${version}`);
  }
  const output = process.platform === 'win32'
    ? execFileSync(process.env.ComSpec, ['/d', '/s', '/c', `npm ${args.join(' ')}`], options)
    : execFileSync('npm', args, options);
  return JSON.parse(output)[version];
}

function main([command, selection, reportPath]) {
  const directories = workspaces(selection);
  if (command === 'workspaces') {
    console.log(directories.join(' '));
    return;
  }
  if (command === 'regenerate-root') {
    if (selection !== 'root') throw new Error('Root regeneration requires root selection');
    regenerateRoot();
    return;
  }
  if (!['verify', 'ages'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const report = [];
  const checkedAt = new Date().toISOString();
  for (const dir of directories) {
    const file = dir === '.' ? 'package-lock.json' : `${dir}/package-lock.json`;
    const current = JSON.parse(readFileSync(file, 'utf8'));
    verifyLockfile(current);
    if (command === 'verify') {
      console.log(`${file}: public registry and sha512 only`);
      continue;
    }
    const previous = JSON.parse(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' }));
    const changed = changedPackages(previous, current);
    console.log(`${file}: ${changed.length} changed package entry/entries`);
    for (const item of changed) {
      const published = npmView(item.name, item.version);
      const ageDays = releaseAge(published, Date.parse(checkedAt));
      const row = { workspace: dir === '.' ? 'root' : dir, ...item, published, ageDays };
      report.push(row);
      console.log(`${item.name} ${item.before} -> ${item.version} published=${published} ageDays=${ageDays.toFixed(2)} PASS`);
    }
  }
  if (command === 'ages') {
    if (!reportPath) throw new Error('A persistent publish-age report path is required');
    writeFileSync(reportPath, JSON.stringify({ checkedAt, minimumAgeDays: 7, packages: report }, null, 2) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exitCode = 1;
  }
}
