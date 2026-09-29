const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { API, BASE, testGuard } = require("./safety.cjs");
const request = require(path.join(API, "node_modules", "supertest"));
const { createTestApp } = require(
  path.join(API, "test", "e2e", "helpers", "app.helper.ts"),
);
const { getLegacyToken } = require(
  path.join(API, "test", "e2e", "helpers", "auth.helper.ts"),
);
const { PrismaService } = require(
  path.join(API, "src", "modules", "prisma", "prisma.service.ts"),
);
const { EndpointService } = require(
  path.join(
    API,
    "src",
    "modules",
    "endpoint",
    "services",
    "endpoint.service.ts",
  ),
);
const { EventEmitter2 } = require(
  path.join(API, "node_modules", "eventemitter2"),
);
const { RepositoryError } = require(
  path.join(API, "src", "domain", "errors", "repository-error.ts"),
);

const backend = process.env.PERSISTENCE_BACKEND;
const USER = "urn:ietf:params:scim:schemas:core:2.0:User";
const GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
const DEVICE = "urn:example:custom:Device";
const EXT = "urn:example:extension:2.0:Matrix";
const GOOGLE =
  "urn:ietf:params:scim:schemas:extension:google:2.0:CloudIdentityUser";
const CONTOSO =
  "urn:ietf:params:scim:schemas:extension:contoso:2.0:ScalarMVUser";
const PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const SEARCH = "urn:ietf:params:scim:api:messages:2.0:SearchRequest";
const OUTPUT = process.env.PG_ANALYSIS_OUTPUT;
const plan = [];
const results = [];
const selected = process.env.PG_ANALYSIS_CASES
  ? new Set(process.env.PG_ANALYSIS_CASES.split(","))
  : null;
let app, identity, prisma;
let serial = 0;
const repos = {};
const copy = (v) => JSON.parse(JSON.stringify(v));
const op = (path, value, verb = "replace") => ({
  op: verb,
  path,
  ...(value === undefined ? {} : { value }),
});
const attr = (name, type, extra = {}) => ({
  name,
  type,
  multiValued: false,
  required: false,
  mutability: "readWrite",
  returned: "default",
  ...extra,
});

function profile(settings = {}, capabilities = {}) {
  const extension = {
    id: EXT,
    name: "SyntheticMatrix",
    attributes: [
      attr("text", "string"),
      attr("requiredText", "string"),
      attr("immutableSerial", "string", { mutability: "immutable" }),
      attr("caseToken", "string", { caseExact: true }),
      attr("hidden", "string", { returned: "never" }),
      attr("onRequest", "string", { returned: "request" }),
      attr("items", "complex", {
        multiValued: true,
        subAttributes: [
          attr("type", "string"),
          attr("value", "string"),
          attr("primary", "boolean"),
          attr("rank", "integer"),
          attr("code", "string", { caseExact: true }),
        ],
      }),
      ...Object.keys(typeValues).flatMap((type) => [
        attr(
          `single${type}`,
          type,
          type === "complex"
            ? { subAttributes: [attr("value", "string")] }
            : {},
        ),
        attr(`multi${type}`, type, {
          multiValued: true,
          ...(type === "complex"
            ? { subAttributes: [attr("value", "string")] }
            : {}),
        }),
      ]),
    ],
  };
  const extensions = [{ schema: EXT, required: false }];
  return {
    schemas: [
      { id: USER, name: "User", attributes: "all" },
      { id: GROUP, name: "Group", attributes: "all" },
      {
        id: DEVICE,
        name: "Device",
        attributes: [
          attr("displayName", "string"),
          attr("label", "string"),
          attr("cost", "integer"),
        ],
      },
      extension,
    ],
    resourceTypes: [
      {
        id: "User",
        name: "User",
        endpoint: "/Users",
        schema: USER,
        schemaExtensions: extensions,
      },
      {
        id: "Group",
        name: "Group",
        endpoint: "/Groups",
        schema: GROUP,
        schemaExtensions: extensions,
      },
      {
        id: "Device",
        name: "Device",
        endpoint: "/Devices",
        schema: DEVICE,
        schemaExtensions: extensions,
      },
    ],
    settings: {
      StrictSchemaValidation: true,
      VerbosePatchSupported: true,
      PrimaryEnforcement: "reject",
      logFileEnabled: false,
      ...settings,
    },
    serviceProviderConfig: {
      patch: { supported: true },
      filter: { supported: true, maxResults: 50 },
      sort: { supported: true },
      etag: { supported: true },
      bulk: { supported: true, maxOperations: 30, maxPayloadSize: 1000000 },
      ...capabilities,
    },
  };
}
const typeValues = {
  string: "synthetic",
  boolean: true,
  integer: 7,
  decimal: 7.25,
  dateTime: "2026-09-25T12:00:00Z",
  binary: "YQ==",
  reference: "https://example.test/Users/reference",
  complex: { value: "synthetic" },
};

class SetupFailure extends Error {}
async function http(method, url, body, headers = {}) {
  let req = request(app.getHttpServer())
    [method](url)
    .set("Authorization", `Bearer ${getLegacyToken()}`)
    .set("Content-Type", "application/scim+json; charset=utf-8");
  for (const [name, value] of Object.entries(headers))
    req = req.set(name, value);
  if (body !== undefined) req = req.send(body);
  const res = await req;
  return { status: res.status, etag: res.headers.etag ?? null, body: res.body };
}
function need(res, status, label) {
  if (res.status !== status)
    throw new SetupFailure(
      `${label}: expected setup ${status}, received ${res.status}: ${JSON.stringify(res.body)}`,
    );
  return res;
}
async function endpoint(p = profile()) {
  const res = need(
    await http("post", "/scim/admin/endpoints", {
      name: `pg-${backend}-${++serial}`,
      profile: p,
    }),
    201,
    "endpoint create",
  );
  return {
    id: res.body.id,
    base: `/scim/v2/endpoints/${res.body.id}`,
    profile: p,
  };
}
const resourceType = (route) =>
  ({ Users: "User", Groups: "Group", Devices: "Device" })[route];
function body(route, fields = {}) {
  const urn = { Users: USER, Groups: GROUP, Devices: DEVICE }[route];
  return {
    schemas: [urn, ...(fields[EXT] ? [EXT] : [])],
    ...(route === "Users"
      ? { userName: `synthetic-${++serial}`, active: true }
      : { displayName: `synthetic-${++serial}` }),
    ...fields,
  };
}
async function create(ep, route, fields = {}) {
  return need(
    await http("post", `${ep.base}/${route}`, body(route, fields)),
    201,
    `${route} create`,
  );
}
const patch = (ep, route, id, Operations, headers) =>
  http(
    "patch",
    `${ep.base}/${route}/${id}`,
    { schemas: [PATCH], Operations },
    headers,
  );
async function stored(ep, route, id) {
  const repo = repos[route];
  const row =
    route === "Devices"
      ? await repo.findByScimId(ep.id, "Device", id)
      : route === "Groups"
        ? await repo.findWithMembers(ep.id, id)
        : await repo.findByScimId(ep.id, id);
  if (!row) return null;
  const result = {
    id: row.id,
    scimId: row.scimId,
    version: row.version,
    payload: JSON.parse(row.rawPayload),
    displayName: row.displayName,
    userName: row.userName,
    active: row.active,
    members: row.members?.map((m) => ({
      value: m.value,
      userId: m.userId,
      type: m.type,
    })),
  };
  if (backend === "prisma") {
    const db = await prisma.scimResource.findUnique({ where: { id: row.id } });
    assert.deepEqual(
      db.payload,
      result.payload,
      "Repository payload must match actual PostgreSQL JSONB",
    );
    assert.equal(db.version, result.version);
    result.databaseReadConfirmed = true;
  }
  return result;
}
function caseOf(id, title, mode, runCase) {
  if (selected && !selected.has(id)) return;
  plan.push({ id, title, mode });
  test(`${id}: ${title}`, async () => {
    const entry = {
      id,
      title,
      mode,
      backend,
      checks: [],
      observations: {},
      status: "running",
    };
    const ctx = {
      observe: (name, value) => {
        entry.observations[name] = value;
      },
      check: (claim, actual, expected) => {
        let passed = true;
        try {
          assert.deepEqual(actual, expected);
        } catch (error) {
          if (error.code !== "ERR_ASSERTION") throw error;
          passed = false;
        }
        entry.checks.push({
          claim,
          passed,
          actual: actual === undefined ? "[undefined]" : actual,
          expected,
        });
      },
      skip: (reason) => {
        entry.status = "not-applicable";
        entry.reason = reason;
      },
    };
    try {
      await runCase(ctx);
      if (entry.status !== "not-applicable") {
        if (entry.checks.length === 0)
          throw new SetupFailure("No outcome assertions collected.");
        entry.status = entry.checks.every((c) => c.passed)
          ? "passed"
          : "behavior-failed";
      }
    } catch (error) {
      entry.status = "setup-failure";
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    } finally {
      results.push(entry);
    }
    expect(["passed", "not-applicable"]).toContain(entry.status);
  });
}

beforeAll(async () => {
  identity = await testGuard();
  app = await createTestApp();
  const readiness = need(
    await http("get", "/scim/health"),
    200,
    "HTTP readiness",
  );
  assert.equal(readiness.body.status, "ok");
  repos.Users = app.get("USER_REPOSITORY");
  repos.Groups = app.get("GROUP_REPOSITORY");
  repos.Devices = app.get("GENERIC_RESOURCE_REPOSITORY");
  prisma = app.get(PrismaService);
  assert.ok(
    repos.Users.constructor.name.startsWith(
      backend === "prisma" ? "Prisma" : "InMemory",
    ),
  );
  identity.http = {
    address: app.getHttpServer().address(),
    health: readiness.body.status,
    readinessVerified: true,
  };
});
afterAll(async () => {
  if (app) await app.close();
  const summary = {
    cases: results.length,
    passed: results.filter((r) => r.status === "passed").length,
    behaviorFailed: results.filter((r) => r.status === "behavior-failed")
      .length,
    setupFailed: results.filter((r) => r.status === "setup-failure").length,
    notApplicable: results.filter((r) => r.status === "not-applicable").length,
    checksPassed: results.flatMap((r) => r.checks).filter((c) => c.passed)
      .length,
    checksFailed: results.flatMap((r) => r.checks).filter((c) => !c.passed)
      .length,
  };
  fs.writeFileSync(
    path.join(OUTPUT, `${backend}.json`),
    JSON.stringify(
      {
        base: BASE,
        backend,
        identity,
        plannedCases: plan,
        summary,
        results,
        method:
          "Existing Nest E2E bootstrap, real HTTP, real repositories; Prisma rows additionally compared with actual JSONB. Seams/faults explicitly labeled.",
      },
      null,
      2,
    ),
  );
});

for (const strict of [true, false]) {
  caseOf(
    `INC-${strict ? "STRICT" : "LENIENT"}`,
    `Four incident operations; strict=${strict}`,
    "HTTP + persisted readback",
    async (c) => {
      const p = profile({ StrictSchemaValidation: strict });
      p.schemas.push(
        {
          id: GOOGLE,
          name: "SyntheticGoogle",
          attributes: [
            attr("primaryOrganization", "complex", {
              subAttributes: [attr("location", "string")],
            }),
            attr("additionalOrganizations", "complex", {
              multiValued: true,
              subAttributes: [attr("type", "string"), attr("symbol", "string")],
            }),
          ],
        },
        {
          id: CONTOSO,
          name: "SyntheticContoso",
          attributes: [
            attr("contacts", "complex", {
              multiValued: true,
              subAttributes: [
                attr("primary", "boolean"),
                attr("value", "string"),
              ],
            }),
          ],
        },
      );
      p.resourceTypes[0].schemaExtensions.push(
        { schema: GOOGLE, required: false },
        { schema: CONTOSO, required: false },
      );
      const ep = await endpoint(p);
      const created = need(
        await http(
          "post",
          `${ep.base}/Users`,
          body("Users", {
            schemas: [USER, GOOGLE, CONTOSO],
            [GOOGLE]: {
              primaryOrganization: { location: "old" },
              additionalOrganizations: [
                { type: "school", symbol: "old" },
                { type: "work", symbol: "old" },
              ],
            },
            [CONTOSO]: { contacts: [{ primary: true, value: "old" }] },
          }),
        ),
        201,
        "incident User create",
      );
      const before = await stored(ep, "Users", created.body.id);
      const response = await patch(
        ep,
        "Users",
        created.body.id,
        [
          op(`${GOOGLE}:primaryOrganization.location`, "new"),
          op(
            `${GOOGLE}:additionalOrganizations[type eq "school"].symbol`,
            "new",
          ),
          op(`${GOOGLE}:additionalOrganizations[type eq "work"].symbol`, "new"),
          op(`${CONTOSO}:contacts[primary eq true].value`, "new"),
        ],
        { "If-Match": created.etag },
      );
      const after = await stored(ep, "Users", created.body.id);
      const read = await http("get", `${ep.base}/Users/${created.body.id}`);
      c.observe("patch", response);
      c.observe("before", before);
      c.observe("storedAfter", after);
      c.observe("getAfter", read);
      c.check(
        "valid four-operation PATCH should succeed",
        response.status,
        200,
      );
      if (strict) {
        c.check(
          "observed rejected PATCH preserves stored payload",
          after.payload,
          before.payload,
        );
        c.check(
          "observed rejected PATCH preserves version",
          after.version,
          before.version,
        );
        c.check(
          "observed rejected PATCH preserves ETag",
          read.etag,
          created.etag,
        );
      } else {
        c.check(
          "three Google values updated",
          [
            after.payload[GOOGLE].primaryOrganization.location,
            ...after.payload[GOOGLE].additionalOrganizations.map(
              (x) => x.symbol,
            ),
          ],
          ["new", "new", "new"],
        );
        c.check(
          "real contact updated",
          after.payload[CONTOSO].contacts[0].value,
          "new",
        );
        c.check(
          "no malformed bracket key stored",
          Object.hasOwn(after.payload[CONTOSO], "contacts[primary eq true]"),
          false,
        );
        c.check(
          "GET reflects persisted extension",
          read.body[CONTOSO],
          after.payload[CONTOSO],
        );
        c.check("one version increment", after.version, before.version + 1);
      }
    },
  );
}

for (const route of ["Users", "Groups", "Devices"]) {
  caseOf(
    `CRUD-${route}`,
    `${route} ordinary create/get/list/search/filter/sort/PUT/PATCH/DELETE`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const created = await create(ep, route, { [EXT]: { text: "created" } });
      const second = await create(ep, route, { [EXT]: { text: "other" } });
      const id = created.body.id;
      const get = await http("get", `${ep.base}/${route}/${id}`);
      c.check("GET retains created extension", get.body[EXT]?.text, "created");
      const field = route === "Users" ? "userName" : "displayName";
      const filter = `${field} eq "${created.body[field]}"`;
      const list = await http(
        "get",
        `${ep.base}/${route}?filter=${encodeURIComponent(filter)}&startIndex=1&count=1`,
      );
      c.check("filtered list status", list.status, 200);
      c.check(
        "filter finds correct ID",
        list.body.Resources?.map((r) => r.id),
        [id],
      );
      const search = await http("post", `${ep.base}/${route}/.search`, {
        schemas: [SEARCH],
        filter,
        count: 1,
      });
      c.check(
        "search returns same ID",
        search.body.Resources?.map((r) => r.id),
        [id],
      );
      const sorted = await http(
        "get",
        `${ep.base}/${route}?sortBy=${field}&sortOrder=descending&count=1`,
      );
      const expected = [created.body, second.body].sort((a, b) =>
        b[field].localeCompare(a[field]),
      )[0].id;
      c.check(
        "sort/pagination first ID",
        sorted.body.Resources?.[0]?.id,
        expected,
      );
      const replacement = body(route, {
        [field]: created.body[field],
        [EXT]: { text: "put" },
      });
      const put = await http("put", `${ep.base}/${route}/${id}`, replacement, {
        "If-Match": get.etag,
      });
      c.check("PUT status", put.status, 200);
      c.check(
        "PUT persisted",
        (await stored(ep, route, id)).payload[EXT]?.text,
        "put",
      );
      const patched = await patch(ep, route, id, [op(`${EXT}:text`, "patch")], {
        "If-Match": put.etag,
      });
      c.check("PATCH status", patched.status, 200);
      c.check(
        "PATCH persisted",
        (await stored(ep, route, id)).payload[EXT]?.text,
        "patch",
      );
      const deleted = await http(
        "delete",
        `${ep.base}/${route}/${id}`,
        undefined,
        { "If-Match": patched.etag },
      );
      c.check("DELETE status", deleted.status, 204);
      c.check("repository row removed", await stored(ep, route, id), null);
      c.check(
        "GET after delete",
        (await http("get", `${ep.base}/${route}/${id}`)).status,
        404,
      );
      c.observe("statuses", {
        get: get.status,
        list: list.status,
        search: search.status,
        sort: sorted.status,
        put: put.status,
        patch: patched.status,
        delete: deleted.status,
      });
    },
  );
  caseOf(
    `SEARCH-ARRAY-${route}`,
    `${route} attributes array and error envelope`,
    "HTTP",
    async (c) => {
      const ep = await endpoint();
      await create(ep, route);
      const r = await http("post", `${ep.base}/${route}/.search`, {
        schemas: [SEARCH],
        attributes: [route === "Users" ? "userName" : "displayName"],
      });
      c.observe("response", r);
      c.check("valid search attributes array accepted", r.status, 200);
      if (r.status >= 400)
        c.check(
          "error detail scalar or absent",
          r.body.detail === undefined || typeof r.body.detail === "string",
          true,
        );
    },
  );
  caseOf(
    `TYPES-${route}`,
    `${route} eight native types x single/multi cardinality`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const data = {};
      for (const [type, value] of Object.entries(typeValues)) {
        data[`single${type}`] = value;
        data[`multi${type}`] = [value];
      }
      const created = await create(ep, route, { [EXT]: data });
      const read = await http("get", `${ep.base}/${route}/${created.body.id}`);
      const db = await stored(ep, route, created.body.id);
      c.observe("read", read);
      c.observe("persisted", db.payload[EXT]);
      for (const [key, value] of Object.entries(data)) {
        c.check(`${key} wire round-trip`, read.body[EXT]?.[key], value);
        c.check(`${key} persisted shape`, db.payload[EXT]?.[key], value);
      }
    },
  );
}

for (const route of ["Users", "Groups", "Devices"]) {
  caseOf(
    `MV-ADD-${route}`,
    `${route} multi-valued extension add preserves prior values`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, route, {
        [EXT]: { items: [{ type: "home", value: "old" }] },
      });
      const response = await patch(ep, route, r.body.id, [
        op(`${EXT}:items`, [{ type: "work", value: "new" }], "add"),
      ]);
      const after = await stored(ep, route, r.body.id);
      c.observe("response", response);
      c.observe("stored", after.payload[EXT]);
      c.check("add accepted", response.status, 200);
      c.check(
        "prior item and new item retained",
        after.payload[EXT]?.items?.map((i) => i.value),
        ["old", "new"],
      );
    },
  );
}
const filters = [
  ["STRING", 'type eq "work"', [{ type: "work", value: "old" }], ["new"]],
  ["BOOLEAN", "primary eq true", [{ primary: true, value: "old" }], ["new"]],
  [
    "QUOTED-BOOLEAN",
    'primary eq "true"',
    [{ primary: true, value: "old" }],
    ["new"],
  ],
  [
    "COMPOUND",
    'type eq "work" and primary eq true',
    [{ type: "work", primary: true, value: "old" }],
    ["new"],
  ],
  ["NUMBER", "rank eq 7", [{ rank: 7, value: "old" }], ["new"]],
  [
    "MULTIMATCH",
    'type eq "work"',
    [
      { type: "work", value: "a" },
      { type: "work", value: "b" },
    ],
    ["new", "new"],
  ],
];
for (const [name, filter, items, expected] of filters) {
  caseOf(
    `VP-${name}`,
    `extension valuePath ${name}`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, "Users", { [EXT]: { items } });
      const response = await patch(ep, "Users", r.body.id, [
        op(`${EXT}:items[${filter}].value`, "new"),
      ]);
      const after = await stored(ep, "Users", r.body.id);
      c.observe("response", response);
      c.observe("stored", after.payload[EXT]);
      c.check("valid selected-value mutation succeeds", response.status, 200);
      c.check(
        "all selected values updated",
        after.payload[EXT]?.items?.map((i) => i.value),
        expected,
      );
    },
  );
}
caseOf(
  "READ-FILTER-TYPED",
  "Boolean, number, compound read filters",
  "HTTP",
  async (c) => {
    const ep = await endpoint();
    const r = await create(ep, "Users", {
      [EXT]: { items: [{ rank: 7, primary: true, type: "work", value: "v" }] },
    });
    for (const filter of [
      `${EXT}:items[primary eq true]`,
      `${EXT}:items[rank eq 7]`,
      `${EXT}:items[type eq "work" and primary eq true]`,
    ]) {
      const res = await http(
        "get",
        `${ep.base}/Users?filter=${encodeURIComponent(filter)}`,
      );
      c.observe(filter, res);
      c.check(
        `${filter} matches`,
        res.body.Resources?.map((x) => x.id),
        [r.body.id],
      );
    }
  },
);

for (const route of ["Users", "Groups", "Devices"]) {
  for (const kind of [
    "REQUIRED-REMOVE",
    "IMMUTABLE-SEQUENCE",
    "IMMUTABLE-REMOVE",
    "IMMUTABLE-PUT",
  ]) {
    caseOf(
      `${kind}-${route}`,
      `${route} ${kind}`,
      "HTTP + persisted readback",
      async (c) => {
        const p = profile();
        if (kind === "REQUIRED-REMOVE")
          p.schemas
            .find((s) => s.id === EXT)
            .attributes.find((a) => a.name === "requiredText").required = true;
        const ep = await endpoint(p);
        const values =
          kind === "REQUIRED-REMOVE"
            ? { requiredText: "required" }
            : kind === "IMMUTABLE-SEQUENCE"
              ? {}
              : { immutableSerial: "first" };
        const r = await create(ep, route, { [EXT]: values });
        const before = await stored(ep, route, r.body.id);
        let response;
        if (kind === "IMMUTABLE-PUT") {
          response = await http(
            "put",
            `${ep.base}/${route}/${r.body.id}`,
            body(route, {
              [route === "Users" ? "userName" : "displayName"]:
                r.body[route === "Users" ? "userName" : "displayName"],
              [EXT]: { text: "replacement" },
            }),
          );
          const after = await stored(ep, route, r.body.id);
          c.observe("response", response);
          c.observe("storedAfter", after);
          c.check(
            "omitted immutable value is preserved or request rejects",
            after.payload[EXT]?.immutableSerial,
            "first",
          );
        } else {
          const operations =
            kind === "IMMUTABLE-SEQUENCE"
              ? [
                  op(`${EXT}:immutableSerial`, "first", "add"),
                  op(`${EXT}:immutableSerial`, "second"),
                ]
              : [
                  op(
                    `${EXT}:${kind === "REQUIRED-REMOVE" ? "requiredText" : "immutableSerial"}`,
                    undefined,
                    "remove",
                  ),
                ];
          response = await patch(ep, route, r.body.id, operations);
          const after = await stored(ep, route, r.body.id);
          c.observe("response", response);
          c.observe("storedAfter", after);
          c.check(
            "invalid invariant transition rejected",
            response.status,
            400,
          );
          c.check(
            "invalid transition leaves original payload",
            after.payload,
            before.payload,
          );
          c.check(
            "invalid transition leaves version",
            after.version,
            before.version,
          );
        }
      },
    );
  }
}
for (const route of ["Users", "Groups", "Devices"]) {
  caseOf(
    `PRIMARY-${route}`,
    `${route} primary selection handoff`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, route, {
        [EXT]: {
          items: [
            { type: "home", primary: true },
            { type: "work", primary: false },
          ],
        },
      });
      const response = await patch(ep, route, r.body.id, [
        op(`${EXT}:items[type eq "work"].primary`, true),
      ]);
      const after = await stored(ep, route, r.body.id);
      c.observe("response", response);
      c.observe("stored", after.payload[EXT]);
      c.check("handoff accepted", response.status, 200);
      c.check(
        "only newly selected item primary",
        after.payload[EXT]?.items?.map((i) => i.primary),
        [false, true],
      );
    },
  );
  caseOf(
    `CASEEXACT-${route}`,
    `${route} caseExact read and PATCH selector`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, route, {
        [EXT]: { caseToken: "ABC", items: [{ code: "ABC", value: "old" }] },
      });
      for (const literal of ["ABC", "abc"]) {
        const res = await http(
          "get",
          `${ep.base}/${route}?filter=${encodeURIComponent(`${EXT}:caseToken eq "${literal}"`)}`,
        );
        c.check(
          `caseExact read ${literal}`,
          res.body.Resources?.map((x) => x.id),
          literal === "ABC" ? [r.body.id] : [],
        );
      }
      const response = await patch(ep, route, r.body.id, [
        op(`${EXT}:items[code eq "abc"].value`, "new"),
      ]);
      const after = await stored(ep, route, r.body.id);
      c.observe("patch", response);
      c.observe("stored", after.payload[EXT]);
      c.check(
        "wrong-case selector has noTarget",
        response.body.scimType,
        "noTarget",
      );
      c.check(
        "wrong-case selector leaves value",
        after.payload[EXT]?.items?.[0]?.value,
        "old",
      );
    },
  );
  caseOf(
    `RETURNED-${route}`,
    `${route} hidden attribute filtering and projection`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, route, {
        [EXT]: { hidden: "match", text: "visible", onRequest: "requested" },
      });
      const read = await http(
        "get",
        `${ep.base}/${route}/${r.body.id}?attributes=${encodeURIComponent(`${EXT}:hidden,${EXT}:text,${EXT}:onRequest`)}`,
      );
      c.check(
        "never-returned hidden on requested GET",
        read.body[EXT]?.hidden,
        undefined,
      );
      c.check("ordinary visible returned", read.body[EXT]?.text, "visible");
      c.check(
        "request-only explicitly included",
        read.body[EXT]?.onRequest,
        "requested",
      );
      const db = await stored(ep, route, r.body.id);
      c.check("hidden is persisted", db.payload[EXT]?.hidden, "match");
      const list = await http(
        "get",
        `${ep.base}/${route}?filter=${encodeURIComponent(`${EXT}:hidden eq "match"`)}`,
      );
      c.observe("list", list);
      c.observe("get", read);
      c.check(
        "hidden attribute still participates in filtering",
        list.body.Resources?.map((x) => x.id),
        [r.body.id],
      );
    },
  );
}

for (const route of ["Users", "Groups", "Devices"]) {
  caseOf(
    `CAPABILITIES-${route}`,
    `${route} profile disables PATCH/filter/sort/ETag`,
    "HTTP",
    async (c) => {
      const ep = await endpoint(
        profile(
          { RequireIfMatch: true },
          {
            patch: { supported: false },
            filter: { supported: false, maxResults: 1 },
            sort: { supported: false },
            etag: { supported: false },
          },
        ),
      );
      const r = await create(ep, route, { [EXT]: { text: "old" } });
      const write = await patch(ep, route, r.body.id, [
        op(`${EXT}:text`, "new"),
      ]);
      const field = route === "Users" ? "userName" : "displayName";
      const filtered = await http(
        "get",
        `${ep.base}/${route}?filter=${encodeURIComponent(`${field} pr`)}`,
      );
      const sorted = await http("get", `${ep.base}/${route}?sortBy=${field}`);
      c.observe("patch", write);
      c.observe("filter", filtered);
      c.observe("sort", sorted);
      c.check("disabled PATCH rejected", write.status >= 400, true);
      c.check("disabled filter rejected", filtered.status >= 400, true);
      c.check("disabled sort rejected", sorted.status >= 400, true);
      c.check("no ETag when disabled", r.etag, null);
    },
  );
  caseOf(
    `LIMIT-${route}`,
    `${route} profile maxResults limits page`,
    "HTTP",
    async (c) => {
      const ep = await endpoint(
        profile({}, { filter: { supported: true, maxResults: 1 } }),
      );
      await create(ep, route);
      await create(ep, route);
      const r = await http("get", `${ep.base}/${route}?count=10`);
      c.observe("list", r);
      c.check("total count preserved", r.body.totalResults, 2);
      c.check("page clamped", r.body.Resources?.length, 1);
    },
  );
}
caseOf(
  "CUSTOM-NUMERIC-SORT",
  "Custom integer sort is numeric",
  "HTTP",
  async (c) => {
    const ep = await endpoint();
    await create(ep, "Devices", { cost: 2 });
    await create(ep, "Devices", { cost: 10 });
    const r = await http(
      "get",
      `${ep.base}/Devices?sortBy=cost&sortOrder=ascending`,
    );
    c.observe("response", r);
    c.check(
      "integer ascending values",
      r.body.Resources?.map((x) => x.cost),
      [2, 10],
    );
  },
);
caseOf(
  "CUSTOM-ETAG-OFF",
  "Custom write ignores RequireIfMatch when ETag capability is off",
  "HTTP",
  async (c) => {
    const ep = await endpoint(
      profile({ RequireIfMatch: true }, { etag: { supported: false } }),
    );
    const r = await create(ep, "Devices");
    const response = await patch(ep, "Devices", r.body.id, [
      op("label", "new"),
    ]);
    c.observe("response", response);
    c.check("write accepted without unavailable ETag", response.status, 200);
  },
);

async function withBarrier(repo, method, trigger, work) {
  const original = repo[method];
  let arrived = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const timer = setTimeout(() => release(), 10000);
  repo[method] = async function (...args) {
    if (trigger(...args)) {
      arrived++;
      if (arrived === 2) release();
      await gate;
    }
    return original.apply(this, args);
  };
  try {
    const result = await work();
    if (arrived !== 2)
      throw new SetupFailure(
        `Barrier reached ${arrived}, expected exactly two`,
      );
    return result;
  } finally {
    clearTimeout(timer);
    repo[method] = original;
  }
}
for (const route of ["Users", "Groups", "Devices"]) {
  for (const barrier of [false, true]) {
    caseOf(
      `CAS-${route}-${barrier ? "BARRIER" : "WIRE"}`,
      `${route} two writers with the same If-Match`,
      barrier
        ? "HTTP + deterministic real-repository pre-write barrier"
        : "plain concurrent HTTP",
      async (c) => {
        const ep = await endpoint();
        const r = await create(ep, route, { [EXT]: { text: "before" } });
        const before = await stored(ep, route, r.body.id);
        const work = () =>
          Promise.all(
            ["a", "b"].map((value) =>
              patch(ep, route, r.body.id, [op(`${EXT}:text`, value)], {
                "If-Match": r.etag,
              }),
            ),
          );
        const method = route === "Groups" ? "updateGroupWithMembers" : "update";
        const responses = barrier
          ? await withBarrier(
              repos[route],
              method,
              (id) => id === before.id,
              work,
            )
          : await work();
        const after = await stored(ep, route, r.body.id);
        c.observe("responses", responses);
        c.observe("storedAfter", after);
        c.check(
          "exactly one write accepted",
          [...responses.map((x) => x.status)].sort((a, b) => a - b),
          [200, 412],
        );
        c.check(
          "only one version increment",
          after.version,
          before.version + 1,
        );
      },
    );
  }
}
for (const barrier of [false, true]) {
  caseOf(
    `UNIQUE-${barrier ? "BARRIER" : "WIRE"}`,
    "Concurrent same-userName creation",
    barrier
      ? "HTTP + deterministic real-repository pre-create barrier"
      : "plain concurrent HTTP",
    async (c) => {
      const ep = await endpoint();
      const name = `duplicate-${++serial}`;
      const work = () =>
        Promise.all(
          [1, 2].map(() =>
            http("post", `${ep.base}/Users`, body("Users", { userName: name })),
          ),
        );
      const responses = barrier
        ? await withBarrier(
            repos.Users,
            "create",
            (input) => input.endpointId === ep.id && input.userName === name,
            work,
          )
        : await work();
      const records = await repos.Users.findAll(ep.id, {});
      c.observe("responses", responses);
      c.observe(
        "storedUserNames",
        records.map((x) => x.userName),
      );
      c.check(
        "one success one uniqueness conflict",
        responses.map((x) => x.status).sort((a, b) => a - b),
        [201, 409],
      );
      c.check("one durable user", records.length, 1);
    },
  );
}

caseOf(
  "GROUP-NATIVE-ROLLBACK",
  "Group aggregate DB constraint failure is atomic",
  "direct real repository; native duplicate-member constraint",
  async (c) => {
    const ep = await endpoint();
    const u = await create(ep, "Users");
    const g = await create(ep, "Groups", { members: [{ value: u.body.id }] });
    const before = await stored(ep, "Groups", g.body.id);
    let error;
    try {
      await repos.Groups.updateGroupWithMembers(
        before.id,
        { displayName: "changed-before-member-failure" },
        [
          { value: "duplicate", userId: null, type: null, display: null },
          { value: "duplicate", userId: null, type: null, display: null },
        ],
      );
    } catch (e) {
      error = { name: e.name, code: e.code, message: e.message };
    }
    const after = await stored(ep, "Groups", g.body.id);
    c.observe("error", error ?? null);
    c.observe("before", before);
    c.observe("after", after);
    c.check("duplicate member rejected by repository", Boolean(error), true);
    c.check("group scalar rolled back", after.displayName, before.displayName);
    c.check("membership rolled back", after.members, before.members);
    c.check("version rolled back", after.version, before.version);
  },
);
caseOf(
  "GROUP-HTTP-FAULT",
  "Group PATCH preserves aggregate on membership persistence failure",
  "HTTP; explicitly injected persistence failure, real storage",
  async (c) => {
    const ep = await endpoint();
    const u = await create(ep, "Users");
    const g = await create(ep, "Groups", { members: [{ value: u.body.id }] });
    const before = await stored(ep, "Groups", g.body.id);
    let original;
    if (backend === "prisma") {
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION analysis_guard.reject_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."groupResourceId" = '${before.id}'::uuid THEN RAISE EXCEPTION 'synthetic member persistence fault'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER analysis_member_fault BEFORE INSERT ON "ResourceMember" FOR EACH ROW EXECUTE FUNCTION analysis_guard.reject_member()',
      );
    } else {
      original = repos.Groups.addMembers;
      repos.Groups.addMembers = async function (id, members) {
        if (id === before.id)
          throw new RepositoryError(
            "UNKNOWN",
            "synthetic member persistence fault",
          );
        return original.call(this, id, members);
      };
    }
    let response;
    try {
      response = await patch(ep, "Groups", g.body.id, [
        op("displayName", "changed"),
        op("members", [{ value: u.body.id }]),
      ]);
    } finally {
      if (backend === "prisma") {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER analysis_member_fault ON "ResourceMember"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION analysis_guard.reject_member()",
        );
      } else repos.Groups.addMembers = original;
    }
    const after = await stored(ep, "Groups", g.body.id);
    c.observe("response", response);
    c.observe("before", before);
    c.observe("after", after);
    c.check("failure reaches HTTP error", response.status >= 500, true);
    c.check("scalar unchanged", after.displayName, before.displayName);
    c.check("members unchanged", after.members, before.members);
    c.check("version unchanged", after.version, before.version);
  },
);
caseOf(
  "ENDPOINT-CASCADE",
  "Endpoint DELETE removes User/Group/custom stored resources",
  "HTTP + direct persisted orphan check",
  async (c) => {
    const ep = await endpoint();
    const u = await create(ep, "Users");
    const g = await create(ep, "Groups", { members: [{ value: u.body.id }] });
    const d = await create(ep, "Devices");
    const response = await http("delete", `/scim/admin/endpoints/${ep.id}`);
    c.observe("response", response);
    c.check("endpoint DELETE accepted", response.status, 204);
    c.check(
      "User repository no orphan",
      await stored(ep, "Users", u.body.id),
      null,
    );
    c.check(
      "Group repository no orphan",
      await stored(ep, "Groups", g.body.id),
      null,
    );
    c.check(
      "custom repository no orphan",
      await stored(ep, "Devices", d.body.id),
      null,
    );
    c.check(
      "public route no longer accessible",
      (await http("get", `${ep.base}/Users/${u.body.id}`)).status,
      404,
    );
  },
);
caseOf(
  "ENDPOINT-CACHE",
  "Two EndpointService instances observe persisted profile changes",
  "two real service caches over same PostgreSQL; not two processes",
  async (c) => {
    if (backend !== "prisma") {
      c.skip(
        "Independent InMemory endpoint services do not share a persistence store; no cross-process parity claim.",
      );
      return;
    }
    const ep = await endpoint();
    const logger = new Proxy({}, { get: () => () => {} });
    const observer = new EndpointService(
      prisma,
      logger,
      repos.Users,
      repos.Groups,
      new EventEmitter2(),
    );
    const first = await observer.getEndpoint(ep.id);
    const changed = await http("patch", `/scim/admin/endpoints/${ep.id}`, {
      profile: { settings: { StrictSchemaValidation: false } },
    });
    const db = await prisma.endpoint.findUnique({ where: { id: ep.id } });
    const second = await observer.getEndpoint(ep.id);
    c.observe("before", first.profile.settings.StrictSchemaValidation);
    c.observe("afterCached", second.profile.settings.StrictSchemaValidation);
    c.observe("database", db.profile.settings.StrictSchemaValidation);
    c.check("admin update accepted", changed.status, 200);
    c.check(
      "DB contains new setting",
      db.profile.settings.StrictSchemaValidation,
      false,
    );
    c.check(
      "other warmed service sees new setting",
      second.profile.settings.StrictSchemaValidation,
      false,
    );
  },
);

caseOf(
  "CUSTOM-PATCH-DISABLED",
  "Custom PATCH disabled without a masking ETag requirement",
  "HTTP + persisted readback",
  async (c) => {
    const ep = await endpoint(profile({}, { patch: { supported: false } }));
    const r = await create(ep, "Devices", { [EXT]: { text: "old" } });
    const response = await patch(ep, "Devices", r.body.id, [
      op(`${EXT}:text`, "new"),
    ]);
    const after = await stored(ep, "Devices", r.body.id);
    c.observe("response", response);
    c.check("disabled capability blocks PATCH", response.status >= 400, true);
    c.check("disabled mutation leaves payload", after.payload[EXT].text, "old");
  },
);
caseOf(
  "TYPED-READ-CONTROL",
  "Native Boolean core and custom numeric read-filter controls",
  "HTTP",
  async (c) => {
    const ep = await endpoint();
    const u = await create(ep, "Users", { active: true });
    const d = await create(ep, "Devices", { cost: 7 });
    for (const [route, filter, id] of [
      ["Users", "active eq true", u.body.id],
      [
        "Users",
        `active eq true and userName eq "${u.body.userName}"`,
        u.body.id,
      ],
      ["Devices", "cost gt 6", d.body.id],
    ]) {
      const r = await http(
        "get",
        `${ep.base}/${route}?filter=${encodeURIComponent(filter)}`,
      );
      c.observe(filter, r);
      c.check(`${route} typed query status`, r.status, 200);
      c.check(
        `${route} typed query selected ID`,
        r.body.Resources?.map((x) => x.id),
        [id],
      );
    }
  },
);
caseOf(
  "CORE-MV-ADD",
  "User core emails add appends rather than replaces",
  "HTTP + persisted readback",
  async (c) => {
    const ep = await endpoint();
    const r = await create(ep, "Users", {
      emails: [{ type: "home", value: "old@example.test" }],
    });
    const response = await patch(ep, "Users", r.body.id, [
      op("emails", [{ type: "work", value: "new@example.test" }], "add"),
    ]);
    const after = await stored(ep, "Users", r.body.id);
    c.observe("response", response);
    c.observe("stored", after.payload.emails);
    c.check("add accepted", response.status, 200);
    c.check(
      "old and new core entries retained",
      after.payload.emails?.map((x) => x.value),
      ["old@example.test", "new@example.test"],
    );
  },
);
caseOf(
  "CORE-BOOLEAN-PATH",
  "User core native Boolean selector changes selected value",
  "HTTP + persisted readback",
  async (c) => {
    const ep = await endpoint();
    const r = await create(ep, "Users", {
      emails: [{ primary: true, value: "old@example.test" }],
    });
    const response = await patch(ep, "Users", r.body.id, [
      op("emails[primary eq true].value", "new@example.test"),
    ]);
    const after = await stored(ep, "Users", r.body.id);
    c.observe("response", response);
    c.observe("stored", after.payload.emails);
    c.check("valid selector accepted", response.status, 200);
    c.check(
      "selected email updated",
      after.payload.emails?.[0]?.value,
      "new@example.test",
    );
  },
);
caseOf(
  "MULTIMATCH-REMOVE",
  "Filtered sub-attribute removal affects every selected value",
  "HTTP + persisted readback",
  async (c) => {
    const ep = await endpoint();
    const r = await create(ep, "Users", {
      [EXT]: {
        items: [
          { type: "work", value: "a" },
          { type: "work", value: "b" },
        ],
      },
    });
    const response = await patch(ep, "Users", r.body.id, [
      op(`${EXT}:items[type eq "work"].value`, undefined, "remove"),
    ]);
    const after = await stored(ep, "Users", r.body.id);
    c.observe("response", response);
    c.observe("stored", after.payload[EXT]);
    c.check("remove accepted", response.status, 200);
    c.check(
      "all selected sub-attributes removed",
      after.payload[EXT].items.map((x) => Object.hasOwn(x, "value")),
      [false, false],
    );
  },
);
for (const route of ["Users", "Groups", "Devices"]) {
  caseOf(
    `NO-PATH-${route}`,
    `${route} pathless add and scalar replace`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const r = await create(ep, route, {
        [EXT]: { text: "old", items: [{ type: "home", value: "old" }] },
      });
      const add = await patch(ep, route, r.body.id, [
        {
          op: "add",
          value: { [EXT]: { items: [{ type: "work", value: "new" }] } },
        },
      ]);
      const afterAdd = await stored(ep, route, r.body.id);
      const replace = await patch(ep, route, r.body.id, [
        { op: "replace", value: { [EXT]: { text: "new" } } },
      ]);
      const afterReplace = await stored(ep, route, r.body.id);
      c.observe("add", add);
      c.observe("replace", replace);
      c.observe("afterAdd", afterAdd.payload[EXT]);
      c.observe("afterReplace", afterReplace.payload[EXT]);
      c.check("pathless add accepted", add.status, 200);
      c.check(
        "pathless add preserves prior list",
        afterAdd.payload[EXT]?.items?.map((x) => x.value),
        ["old", "new"],
      );
      c.check("pathless scalar replace accepted", replace.status, 200);
      c.check("scalar replaced", afterReplace.payload[EXT]?.text, "new");
      c.check(
        "replace preserves unspecified sibling",
        afterReplace.payload[EXT]?.items,
        afterAdd.payload[EXT]?.items,
      );
    },
  );
  caseOf(
    `ETAG-CONTROL-${route}`,
    `${route} sequential stale/missing If-Match checks`,
    "HTTP + persisted readback",
    async (c) => {
      const ep = await endpoint(profile({ RequireIfMatch: true }));
      const r = await create(ep, route, { [EXT]: { text: "old" } });
      const missing = await patch(ep, route, r.body.id, [
        op(`${EXT}:text`, "missing"),
      ]);
      const first = await patch(
        ep,
        route,
        r.body.id,
        [op(`${EXT}:text`, "first")],
        { "If-Match": r.etag },
      );
      const stale = await patch(
        ep,
        route,
        r.body.id,
        [op(`${EXT}:text`, "stale")],
        { "If-Match": r.etag },
      );
      const after = await stored(ep, route, r.body.id);
      c.observe("statuses", [missing.status, first.status, stale.status]);
      c.check(
        "missing/current/stale enforcement",
        [missing.status, first.status, stale.status],
        [428, 200, 412],
      );
      c.check(
        "stale request did not overwrite",
        after.payload[EXT].text,
        "first",
      );
    },
  );
  caseOf(
    `CARDINALITY-NEGATIVE-${route}`,
    `${route} wrong scalar/cardinality rejection`,
    "HTTP",
    async (c) => {
      const ep = await endpoint();
      for (const [key, value] of [
        ["singleinteger", "wrong"],
        ["multistring", "not-array"],
        ["singleboolean", []],
      ]) {
        const r = await http(
          "post",
          `${ep.base}/${route}`,
          body(route, { [EXT]: { [key]: value } }),
        );
        c.observe(key, r);
        c.check(`${key} invalid representation rejected`, r.status, 400);
      }
    },
  );
}
caseOf(
  "GROUP-POST-FAULT",
  "Group POST member failure does not leave a partial group",
  "HTTP; injected member-insert failure, real storage",
  async (c) => {
    const ep = await endpoint();
    const user = await create(ep, "Users");
    let original;
    if (backend === "prisma") {
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION analysis_guard.reject_post_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS (SELECT 1 FROM "ScimResource" WHERE id=NEW."groupResourceId" AND "endpointId"='${ep.id}'::uuid) THEN RAISE EXCEPTION 'synthetic Group POST member failure'; END IF; RETURN NEW; END $$`,
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER analysis_post_member_fault BEFORE INSERT ON "ResourceMember" FOR EACH ROW EXECUTE FUNCTION analysis_guard.reject_post_member()',
      );
    } else {
      original = repos.Groups.addMembers;
      repos.Groups.addMembers = async () => {
        throw new RepositoryError(
          "UNKNOWN",
          "synthetic Group POST member failure",
        );
      };
    }
    let response;
    try {
      response = await http(
        "post",
        `${ep.base}/Groups`,
        body("Groups", { members: [{ value: user.body.id }] }),
      );
    } finally {
      if (backend === "prisma") {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER analysis_post_member_fault ON "ResourceMember"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION analysis_guard.reject_post_member()",
        );
      } else repos.Groups.addMembers = original;
    }
    const groups = await repos.Groups.findAllWithMembers(ep.id, {});
    c.observe("response", response);
    c.observe(
      "partialGroups",
      groups.map((g) => ({
        id: g.scimId,
        displayName: g.displayName,
        members: g.members.length,
      })),
    );
    c.check("member failure is an HTTP error", response.status >= 500, true);
    c.check("no partially created group remains", groups.length, 0);
  },
);

require("./alias-cases.cjs")({
  caseOf,
  profile,
  endpoint,
  create,
  http,
  patch,
  stored,
  op,
  attr,
  copy,
  getApp: () => app,
  EXT,
  PATCH,
});

if (selected) {
  assert.deepEqual(
    [...selected].sort(),
    plan.map((c) => c.id).sort(),
    "Unknown or duplicate selected evidence ID",
  );
}
