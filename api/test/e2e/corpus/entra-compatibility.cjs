// Synthetic examples only. Source shapes and limits: docs/SCIM_ENTRA_COMPATIBILITY.md.
// The same assertions run through Supertest and the owned built-server fetch adapter.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const preset = require("../../../src/modules/scim/endpoint-profile/presets/entra-id.json");
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const DIAG = "urn:scimserver:api:messages:2.0:Diagnostics";
const WARNING = "urn:scimserver:api:messages:2.0:Warning";
const patch = (...Operations) => ({ schemas: [PATCH], Operations });
const cases = [];
const scenario = (id, title, settings, run) =>
  cases.push({ id, title, settings, run });

scenario("E01", "native User POST, GET, matching and empty queries, PUT and DELETE", {
  AllowAndCoerceBooleanStrings: false,
}, async c => {
  const user = await c.user();
  c.eq(user.active, true);
  c.eq(user.emails[0].primary, true);
  c.eq(user[ENTERPRISE].employeeNumber, "employee-1");
  const match = await c.call("GET", `/Users?filter=${encodeURIComponent(`userName eq "${user.userName}"`)}`);
  c.eq(match.body.totalResults, 1);
  c.eq(match.body.Resources[0].id, user.id);
  c.eq(match.body.Resources[0].name.givenName, "Alex");
  const empty = await c.call("GET", `/Users?filter=${encodeURIComponent('userName eq "absent@example.com"')}`);
  c.eq(empty.body.Resources, []);
  c.eq(empty.body.totalResults, 0);
  c.eq(empty.body.schemas, ["urn:ietf:params:scim:api:messages:2.0:ListResponse"]);
  c.keys(empty.body, ["schemas", "Resources", "totalResults", "startIndex", "itemsPerPage"]);
  const replaced = await c.call("PUT", `/Users/${user.id}`, {
    schemas: [USER], userName: user.userName, active: true, displayName: "Replacement", emails: user.emails,
  });
  c.eq(replaced.body.displayName, "Replacement");
  const read = await c.read("Users", user.id);
  c.eq(read.name, undefined);
  c.eq(read[ENTERPRISE], undefined);
  await c.call("DELETE", `/Users/${user.id}`, undefined, 204);
  c.error(await c.call("GET", `/Users/${user.id}`, undefined, 404), 404);
});

scenario("E02", "modern native disable and re-enable do not require Boolean coercion", {
  AllowAndCoerceBooleanStrings: false,
}, async c => {
  const user = await c.user();
  for (const active of [false, true]) {
    await c.call("PATCH", `/Users/${user.id}`, patch({ op: "Replace", path: "active", value: active }));
    c.eq((await c.read("Users", user.id)).active, active);
  }
});

scenario("E03", "legacy quoted active values with explicit coercion", {
  AllowAndCoerceBooleanStrings: true,
}, async c => {
  const user = await c.user();
  await c.call("PATCH", `/Users/${user.id}`, patch({ op: "Replace", path: "active", value: "False" }));
  c.eq((await c.read("Users", user.id)).active, false);
});

for (const enabled of [false, true]) {
  scenario(enabled ? "E04" : "E05", `quoted complex Boolean POST coercion=${enabled}`, {
    AllowAndCoerceBooleanStrings: enabled,
  }, async c => {
    const input = c.userInput();
    input.emails[0].primary = "True";
    const result = await c.call("POST", "/Users", input, enabled ? 201 : 400);
    if (enabled) {
      c.eq((await c.read("Users", result.body.id)).emails[0].primary, true);
    } else {
      c.error(result, 400, "invalidValue");
      const list = await c.call("GET", `/Users?filter=${encodeURIComponent(`userName eq "${input.userName}"`)}`);
      c.eq(list.body.totalResults, 0);
    }
  });
}

scenario("E06", "modern filtered email and dotted name PATCH preserve untouched fields", {
  VerbosePatchSupported: true,
}, async c => {
  const user = await c.user();
  await c.call("PATCH", `/Users/${user.id}`, patch(
    { op: "Replace", path: 'emails[type eq "work"].value', value: "new@example.com" },
    { op: "Replace", path: "name.familyName", value: "Updated" },
    { op: "Add", path: "nickName", value: "Lex" },
  ));
  const read = await c.read("Users", user.id);
  c.eq(read.emails[0].value, "new@example.com");
  c.eq(read.name, { givenName: "Alex", familyName: "Updated" });
  c.eq(read.nickName, "Lex");
  c.eq(read["name.familyName"], undefined);
});

scenario("E07", "native Boolean selector updates its actual target under strict validation", {
  AllowAndCoerceBooleanStrings: false, VerbosePatchSupported: true,
}, async c => {
  const user = await c.user();
  await c.call("PATCH", `/Users/${user.id}`, patch({
    op: "replace", path: "emails[primary eq true].value", value: "primary@example.com",
  }));
  const read = await c.read("Users", user.id);
  c.eq(read.emails[0].value, "primary@example.com");
  c.eq(read.emails[0].primary, true);
  c.eq(read["emails[primary eq true]"], undefined);
});

scenario("I03", "verbose-disabled explicit dotted path rejects without a write", {
  VerbosePatchSupported: false,
}, async c => {
  const user = await c.user();
  const before = await c.read("Users", user.id);
  c.error(await c.call("PATCH", `/Users/${user.id}`, patch(
    { op: "Replace", path: "name.familyName", value: "Updated" },
  ), 400), 400);
  c.eq(await c.read("Users", user.id), before);
});

scenario("E08", "unknown attributes fail with strict validation enabled", {}, async c => {
  const input = { ...c.userInput(), unregisteredAttribute: "bad" };
  c.error(await c.call("POST", "/Users", input, 400), 400);
  c.eq((await c.call("GET", `/Users?filter=${encodeURIComponent(`userName eq "${input.userName}"`)}`)).body.totalResults, 0);
});

scenario("E09", "Group create, filtered lookup, projected GET, PUT and delete", {}, async c => {
  const user = await c.user();
  const group = await c.group([{ value: user.id }]);
  const match = await c.call("GET", `/Groups?filter=${encodeURIComponent(`displayName eq "${group.displayName}"`)}&excludedAttributes=members`);
  c.eq(match.body.totalResults, 1);
  c.eq(match.body.Resources[0].id, group.id);
  c.eq(match.body.Resources[0].members, undefined);
  await c.call("PUT", `/Groups/${group.id}`, { schemas: [GROUP], displayName: "Renamed", members: [] });
  const read = await c.read("Groups", group.id);
  c.eq(read.displayName, "Renamed");
  c.eq(read.members ?? [], []);
  await c.call("DELETE", `/Groups/${group.id}`, undefined, 204);
  c.error(await c.call("GET", `/Groups/${group.id}`, undefined, 404), 404);
});

for (const legacy of [false, true]) {
  scenario(legacy ? "E11" : "E10", `${legacy ? "legacy value-array" : "modern filtered"} Group member removal`, {}, async c => {
    const first = await c.user();
    const second = await c.user();
    const group = await c.group([{ value: first.id }]);
    await c.call("PATCH", `/Groups/${group.id}`, patch({
      op: "Add", path: "members", value: [{ value: second.id }],
    }));
    c.eq((await c.read("Groups", group.id)).members.map(m => m.value).sort(), [first.id, second.id].sort());
    await c.call("PATCH", `/Groups/${group.id}`, patch(legacy
      ? { op: "Remove", path: "members", value: [{ value: first.id }] }
      : { op: "remove", path: `members[value eq "${first.id}"]` }));
    c.eq((await c.read("Groups", group.id)).members.map(m => m.value), [second.id]);
  });
}

scenario("E12", "multi-member operation policy rejects two additions without a partial write", {
  MultiMemberPatchOpForGroupEnabled: false,
}, async c => {
  const first = await c.user();
  const second = await c.user();
  const group = await c.group();
  const before = await c.read("Groups", group.id);
  c.error(await c.call("PATCH", `/Groups/${group.id}`, patch({
    op: "add", path: "members", value: [{ value: first.id }, { value: second.id }],
  }), 400), 400);
  c.eq(await c.read("Groups", group.id), before);
});

scenario("E13", "soft-delete policy blocks native false without changing the User", {
  UserSoftDeleteEnabled: false,
}, async c => {
  const user = await c.user();
  const before = await c.read("Users", user.id);
  c.error(await c.call("PATCH", `/Users/${user.id}`, patch({
    op: "replace", path: "active", value: false,
  }), 400), 400);
  c.eq(await c.read("Users", user.id), before);
});

for (const resource of ["User", "Group"]) {
  scenario(resource === "User" ? "E14" : "E15", `${resource} hard-delete policy preserves the resource`, {
    [`${resource}HardDeleteEnabled`]: false,
  }, async c => {
    const item = resource === "User" ? await c.user() : await c.group();
    const before = await c.read(`${resource}s`, item.id);
    c.error(await c.call("DELETE", `/${resource}s/${item.id}`, undefined, 400), 400);
    c.eq(await c.read(`${resource}s`, item.id), before);
  });
}

scenario("E16", "array-wrapped active is not a supported Boolean form", {
  AllowAndCoerceBooleanStrings: true,
}, async c => {
  const user = await c.user();
  const before = await c.read("Users", user.id);
  c.error(await c.call("PATCH", `/Users/${user.id}`, patch({
    op: "Replace", path: "active", value: [{ value: "False" }],
  }), 400), 400, "invalidSyntax");
  c.eq(await c.read("Users", user.id), before);
});

scenario("E17", "modern pathless dotted and enterprise update resolves into actual fields", {
  VerbosePatchSupported: true,
}, async c => {
  const user = await c.user();
  await c.call("PATCH", `/Users/${user.id}`, patch({ op: "replace", value: {
    displayName: "Changed", "name.givenName": "Robin", "name.familyName": "Updated",
    [`${ENTERPRISE}:employeeNumber`]: "employee-2",
  } }));
  const read = await c.read("Users", user.id);
  c.eq(read.name, { givenName: "Robin", familyName: "Updated" });
  c.eq(read[ENTERPRISE].employeeNumber, "employee-2");
  c.eq(read["name.givenName"], undefined);
});

scenario("I02", "sequential primary handoff retains the prior email", {
  PrimaryEnforcement: "reject",
}, async c => {
  const user = await c.user();
  await c.call("PATCH", `/Users/${user.id}`, patch({
    op: "add", path: "emails", value: [{ type: "home", value: "home@example.com", primary: true }],
  }));
  const emails = (await c.read("Users", user.id)).emails;
  c.eq(emails.length, 2);
  c.eq(emails.find(e => e.type === "work").primary, false);
  c.eq(emails.find(e => e.type === "home").primary, true);
});

async function runCase(test, send) {
  let assertions = 0;
  const eq = (actual, expected) => { assert.deepEqual(actual, expected); assertions++; };
  const ok = value => { assert.ok(value); assertions++; };
  const keys = (body, allowed) => { for (const key of Object.keys(body)) ok(allowed.includes(key)); };
  const error = (response, status, scimType) => {
    eq(response.status, status);
    eq(response.body.status, String(status));
    eq(response.body.schemas[0], "urn:ietf:params:scim:api:messages:2.0:Error");
    eq(typeof response.body.detail, "string");
    if (scimType) eq(response.body.scimType, scimType);
    keys(response.body, ["schemas", "status", "scimType", "detail", DIAG]);
  };
  const profile = structuredClone(preset.profile);
  profile.settings = { ...profile.settings, StrictSchemaValidation: true, ...test.settings };
  const endpoint = await send("POST", "/scim/admin/endpoints", { name: `p9-${test.id}-${randomUUID()}`, profile });
  eq(endpoint.status, 201);
  const base = `/scim/endpoints/${endpoint.body.id}`;
  const call = async (method, path, body, status = 200) => {
    const response = await send(method, `${base}${path}`, body);
    assert.equal(response.status, status, `${test.id} ${method} ${path}: ${JSON.stringify(response.body)}`);
    assertions++;
    if (response.body?.id && response.body?.meta?.resourceType) {
      const common = ["schemas", "id", "externalId", "meta", WARNING];
      keys(response.body, response.body.meta.resourceType === "User"
        ? [...common, "userName", "displayName", "active", "name", "emails", "nickName", "groups", ENTERPRISE]
        : [...common, "displayName", "members"]);
      keys(response.body.meta, ["resourceType", "created", "lastModified", "location", "version"]);
      eq(response.body.meta.resourceType, path.startsWith("/Users") ? "User" : "Group");
      ok(response.body.schemas.includes(path.startsWith("/Users") ? USER : GROUP));
    }
    return response;
  };
  const userInput = () => ({
    schemas: [USER, ENTERPRISE], userName: `p9-${randomUUID()}@example.com`, active: true, displayName: "Alex Example",
    name: { givenName: "Alex", familyName: "Example" },
    emails: [{ value: "alex@example.com", type: "work", primary: true }],
    [ENTERPRISE]: { employeeNumber: "employee-1" },
  });
  try {
    eq(endpoint.body.profile.settings.StrictSchemaValidation, true);
    await test.run({
      eq, ok, keys, error, call, userInput,
      user: async () => (await call("POST", "/Users", userInput(), 201)).body,
      group: async (members = []) => (await call("POST", "/Groups", {
        schemas: [GROUP], displayName: `P9-${randomUUID()}`, members,
      }, 201)).body,
      read: async (resource, id) => (await call("GET", `/${resource}/${id}`)).body,
    });
  } finally {
    eq((await send("DELETE", `/scim/admin/endpoints/${endpoint.body.id}`)).status, 204);
    eq((await send("GET", `/scim/admin/endpoints/${endpoint.body.id}`)).status, 404);
  }
  return { id: test.id, assertions };
}

module.exports = { cases, runCase };
