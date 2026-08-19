// Validate that every GitHub Actions workflow file parses as YAML and has the
// structure Actions requires. A malformed workflow does not fail any build - it
// simply never runs, or silently drops a job - so this is checked explicitly.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const yamlPath = path.join(here, '..', 'api', 'node_modules', 'js-yaml', 'index.js');
const yaml = (await import(pathToFileURL(yamlPath).href)).default;

const dir = path.join(here, '..', '.github', 'workflows');
const files = fs.readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));
let bad = 0;

for (const f of files) {
  const full = path.join(dir, f);
  try {
    const doc = yaml.load(fs.readFileSync(full, 'utf8'));
    if (!doc || typeof doc !== 'object') throw new Error('not a mapping');
    if (!doc.jobs || Object.keys(doc.jobs).length === 0) throw new Error('no jobs');
    // `on:` is parsed by js-yaml as the boolean true (YAML 1.1 legacy), so
    // accept either spelling rather than reporting a false failure.
    const on = doc.on ?? doc[true];
    if (!on) throw new Error('no trigger (on:)');
    const jobs = Object.keys(doc.jobs);
    for (const j of jobs) {
      if (!doc.jobs[j]['runs-on'] && !doc.jobs[j].uses) {
        throw new Error(`job '${j}' has neither runs-on nor uses`);
      }
    }
    console.log(`OK    ${f}  jobs=${jobs.join(',')}`);
  } catch (e) {
    bad++;
    console.log(`FAIL  ${f}  ${e.message}`);
  }
}

console.log(`\n${files.length} workflow file(s), ${bad} invalid`);
process.exit(bad === 0 ? 0 : 1);
