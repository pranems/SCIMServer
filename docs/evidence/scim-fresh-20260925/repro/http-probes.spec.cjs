const { writeFileSync } = require("node:fs");
const path = require("node:path");
const { BASE, API, OUTPUT, prepare } = require("./runtime.cjs");
prepare({ changeDirectory: false });
const request = require(path.join(API, "node_modules", "supertest"));
const { createTestApp } = require(
  path.join(API, "test", "e2e", "helpers", "app.helper.ts"),
);
const { getLegacyToken } = require(
  path.join(API, "test", "e2e", "helpers", "auth.helper.ts"),
);

const core = "urn:ietf:params:scim:schemas:core:2.0:User";
const ext = "urn:example:extension:2.0:Analysis";
const custom = "urn:example:custom:Widget";
const observations = [];
let app;
let base;
const client = (method, url, body) =>
  request(app.getHttpServer())
    [method](url)
    .set("Authorization", `Bearer ${getLegacyToken()}`)
    .set("Content-Type", "application/scim+json; charset=utf-8")
    .send(body);

beforeAll(async () => {
  app = await createTestApp();
  const endpoint = await client("post", "/scim/admin/endpoints", {
    name: `fresh-analysis-${Date.now()}`,
    profile: {
      schemas: [
        {
          id: core,
          name: "User",
          attributes: [{ name: "userName" }, { name: "active" }],
        },
        {
          id: ext,
          name: "Analysis",
          attributes: [
            {
              name: "contacts",
              type: "complex",
              multiValued: true,
              subAttributes: [
                { name: "primary", type: "boolean" },
                { name: "value", type: "string" },
              ],
            },
          ],
        },
        {
          id: custom,
          name: "Widget",
          attributes: [{ name: "label", type: "string" }],
        },
      ],
      resourceTypes: [
        {
          id: "User",
          name: "User",
          endpoint: "/Users",
          schema: core,
          schemaExtensions: [{ schema: ext, required: false }],
        },
        {
          id: "Widget",
          name: "Widget",
          endpoint: "/Widgets",
          schema: custom,
          schemaExtensions: [],
        },
      ],
      settings: {
        StrictSchemaValidation: true,
        VerbosePatchSupported: true,
        logFileEnabled: false,
      },
    },
  }).expect(201);
  base = `/scim/v2/endpoints/${endpoint.body.id}`;
});
afterAll(async () => {
  writeFileSync(
    path.join(OUTPUT, "http-observations.json"),
    JSON.stringify(
      { baseline: BASE, expectedFailingNormativeChecks: true, observations },
      null,
      2,
    ),
  );
  if (app) await app.close();
});

it("native Boolean extension valuePath should update the actual selected contact", async () => {
  const created = await client("post", `${base}/Users`, {
    schemas: [core, ext],
    userName: "synthetic-http",
    [ext]: { contacts: [{ primary: true, value: "old" }] },
  }).expect(201);
  const body = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [
      {
        op: "replace",
        path: `${ext}:contacts[primary eq true].value`,
        value: "new",
      },
    ],
  };
  const response = await client(
    "patch",
    `${base}/Users/${created.body.id}`,
    body,
  );
  observations.push({
    id: "H1",
    expectedStatus: 200,
    input: body,
    actualStatus: response.status,
    response: response.body,
  });
  expect(response.status).toBe(200);
  expect(response.body[ext].contacts).toEqual([
    { primary: true, value: "new" },
  ]);
});
it("User .search should accept the RFC array attributes representation", async () => {
  const body = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
    attributes: ["userName"],
  };
  const response = await client("post", `${base}/Users/.search`, body);
  observations.push({
    id: "H2",
    expectedStatus: 200,
    input: body,
    actualStatus: response.status,
    response: response.body,
  });
  expect(response.status).toBe(200);
});
it("custom .search should accept the RFC array attributes representation", async () => {
  await client("post", `${base}/Widgets`, {
    schemas: [custom],
    label: "synthetic",
  }).expect(201);
  const body = {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
    attributes: ["label"],
  };
  const response = await client("post", `${base}/Widgets/.search`, body);
  observations.push({
    id: "H3",
    expectedStatus: 200,
    input: body,
    actualStatus: response.status,
    response: response.body,
  });
  expect(response.status).toBe(200);
});
