const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { liveFetch } = require('./live-test-http.cjs');

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}
const baseUrl = argumentsByName.get('--base-url');
const token = argumentsByName.get('--token');
const readerUrl = argumentsByName.get('--reader-url') ?? baseUrl;
assert.ok(baseUrl && token, 'Supply --base-url and --token.');
const checks = [];

async function request(method, path, body, ifMatch, base = baseUrl) {
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/scim+json';
  if (ifMatch !== undefined) headers['If-Match'] = ifMatch;
  const response = await liveFetch(`${base.replace(/\/$/, '')}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : undefined,
    etag: response.headers.get('etag'),
  };
}

function check(success, message) {
  checks.push({ Success: success, Message: message });
  assert.ok(success, message);
}

async function main() {
  let endpointPath;
  try {
    const created = await request('POST', '/scim/admin/endpoints', {
      name: `live-conditional-${randomUUID()}`,
      profilePreset: 'rfc-standard',
    });
    assert.equal(created.status, 201, 'Create the owned endpoint');
    assert.equal(typeof created.body.id, 'string');
    endpointPath = `/scim/admin/endpoints/${created.body.id}`;
    const read = await request('GET', endpointPath, undefined, undefined, readerUrl);
    const summary = await request('GET', `${endpointPath}?view=summary`, undefined, undefined, readerUrl);
    check(read.status === 200 && summary.status === 200 && summary.etag === read.etag, 'Full and summary reads publish the same editable-state token');
    check(!Object.hasOwn(summary.body, 'profile') && Object.hasOwn(summary.body, 'profileSummary'), 'Summary stays projected without the full profile');

    const attempts = await Promise.all([
      request('PATCH', endpointPath, { displayName: 'First editor' }, read.etag),
      request('PATCH', endpointPath, { displayName: 'Second editor' }, read.etag, readerUrl),
    ]);
    const statuses = attempts.map(result => result.status).sort();
    check(statuses[0] === 200 && statuses[1] === 412, 'Concurrent conditional edits have one winner and one rejected stale writer');
    const winner = attempts.find(result => result.status === 200);
    const loser = attempts.find(result => result.status === 412);
    const current = await request('GET', endpointPath, undefined, undefined, readerUrl);
    check(current.body.displayName === winner.body.displayName && current.etag === winner.etag, 'Read-back contains only the winning edit');
    check(loser.body.status === '412' && loser.body.scimType === 'versionMismatch'
      && typeof loser.body.detail === 'string' && loser.body.currentETag === current.etag, 'Conflict reports the current state token and scalar error detail');

    const identical = await request('PATCH', endpointPath, { displayName: current.body.displayName }, current.etag);
    check(identical.status === 200 && identical.etag === current.etag, 'Identical content can be resubmitted with the same token');
    const wildcard = await request('PATCH', endpointPath, { displayName: 'Wildcard edit' }, '*');
    check(wildcard.status === 200 && wildcard.body.displayName === 'Wildcard edit', 'Wildcard edits remain supported');
    const unconditional = await request('PATCH', endpointPath, { displayName: 'Unconditional edit' });
    check(unconditional.status === 200 && unconditional.body.displayName === 'Unconditional edit', 'Omitting If-Match preserves unconditional behavior');
  } finally {
    if (endpointPath) {
      const deleted = await request('DELETE', endpointPath);
      assert.equal(deleted.status, 204, 'Delete the owned endpoint');
    }
  }
  console.log(JSON.stringify(checks, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
