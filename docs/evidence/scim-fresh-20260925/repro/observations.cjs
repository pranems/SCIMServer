const fs = require("node:fs");
const path = require("node:path");
const { BASE, OUTPUT, prepare, registerTypeScript } = require("./runtime.cjs");
prepare();
registerTypeScript();
const load = (p) => require(path.resolve("api/src", p));
const { UserPatchEngine } = load("domain/patch/user-patch-engine.ts");
const { GroupPatchEngine } = load("domain/patch/group-patch-engine.ts");
const { GenericPatchEngine } = load("domain/patch/generic-patch-engine.ts");
const { SchemaValidator } = load("domain/validation/schema-validator.ts");
const { EndpointScimUsersService } = load(
  "modules/scim/services/endpoint-scim-users.service.ts",
);
const { EndpointContextStorage } = load(
  "modules/endpoint/endpoint-context.storage.ts",
);
const { ScimSchemaRegistry } = load(
  "modules/scim/discovery/scim-schema-registry.ts",
);
const { ScimMetadataService } = load(
  "modules/scim/services/scim-metadata.service.ts",
);
const { InMemoryUserRepository } = load(
  "infrastructure/repositories/inmemory/inmemory-user.repository.ts",
);
const { validateAndExpandProfile } = load(
  "modules/scim/endpoint-profile/endpoint-profile.service.ts",
);
const { ENDPOINT_CONFIG_FLAGS_DEFINITIONS } = load(
  "modules/endpoint/endpoint-config.interface.ts",
);
const util = load("modules/scim/utils/scim-patch-path.ts");
const core = "urn:ietf:params:scim:schemas:core:2.0:User";
const patchSchema = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const ext = "urn:example:extension:2.0:Probe";
const clone = (v) => JSON.parse(JSON.stringify(v));
const state = (payload) => ({
  userName: "synthetic-user",
  displayName: null,
  externalId: null,
  active: true,
  rawPayload: payload,
});
const attr = (name, type, rest = {}) => ({
  name,
  type,
  multiValued: false,
  required: false,
  ...rest,
});
const schemas = [
  {
    id: core,
    isCoreSchema: true,
    attributes: [
      attr("userName", "string", { required: true }),
      attr("active", "boolean"),
      attr("requiredCustom", "string", { required: true }),
      attr("items", "complex", {
        multiValued: true,
        subAttributes: [
          attr("value", "string"),
          attr("type", "string"),
          attr("primary", "boolean"),
        ],
      }),
      attr("name", "complex", {
        subAttributes: [
          attr("givenName", "string"),
          attr("familyName", "string"),
        ],
      }),
    ],
  },
  {
    id: ext,
    attributes: [
      attr("contacts", "complex", {
        multiValued: true,
        subAttributes: [
          attr("value", "string"),
          attr("primary", "boolean"),
          attr("type", "string"),
        ],
      }),
      attr("tags", "string", { multiValued: true }),
      attr("mandatory", "string", { required: true }),
      attr("label", "string"),
    ],
  },
];
const rows = [];
async function probe(id, purpose, fn) {
  try {
    rows.push({ id, purpose, observed: await fn() });
  } catch (e) {
    rows.push({
      id,
      purpose,
      error: e.getResponse?.() ?? {
        name: e.name,
        message: e.message,
        status: e.status,
        scimType: e.scimType,
      },
    });
  }
}
const op = (path, value, verb = "replace") => ({ op: verb, path, value });
const userApply = (payload, operations, config = {}) =>
  UserPatchEngine.apply(operations, state(clone(payload)), {
    extensionUrns: [ext],
    verbosePatch: true,
    ...config,
  });
const validate = (payload) =>
  SchemaValidator.validate(payload, schemas, {
    strictMode: true,
    mode: "patch",
  });
async function main() {
  await probe("P01", "Native boolean extension valuePath parse", () =>
    util.parseExtensionPath(`${ext}:contacts[primary eq true].value`, [ext]),
  );
  await probe(
    "P02",
    "Native boolean extension path persists a literal key",
    () =>
      userApply({ [ext]: { contacts: [{ primary: true, value: "old" }] } }, [
        op(`${ext}:contacts[primary eq true].value`, "new"),
      ]),
  );
  await probe("P03", "Native boolean core valuePath silently no-ops", () =>
    userApply({ items: [{ primary: true, value: "old" }] }, [
      op("items[primary eq true].value", "new"),
    ]),
  );
  await probe("P04", "Filter matches multiple entries", () =>
    userApply(
      {
        items: [
          { type: "work", value: "a" },
          { type: "work", value: "b" },
        ],
      },
      [op('items[type eq "work"].value', "new")],
    ),
  );
  await probe("P05", "ne filter semantics", () =>
    userApply(
      {
        items: [
          { type: "work", value: "a" },
          { type: "home", value: "b" },
        ],
      },
      [op('items[type ne "work"].value', "new")],
    ),
  );
  await probe("P06", "Add to existing multi-valued core attribute", () =>
    userApply({ items: [{ value: "a" }] }, [
      op("items", [{ value: "b" }], "add"),
    ]),
  );
  await probe("P07", "Valid multi-valued primitive extension PATCH", () =>
    userApply({ [ext]: { tags: ["a"] } }, [op(`${ext}:tags`, ["b"])]),
  );
  await probe("P08", "Primitive arrays valid on schema POST", () =>
    SchemaValidator.validate(
      {
        schemas: [core, ext],
        userName: "x",
        requiredCustom: "r",
        [ext]: { mandatory: "m", tags: ["a", "b"] },
      },
      schemas,
      { strictMode: true, mode: "create" },
    ),
  );
  await probe(
    "P09",
    "Filtered complex selected entry object prevalidation",
    () =>
      SchemaValidator.validatePatchOperationValue(
        "replace",
        'items[type eq "work"]',
        { type: "work", value: "b" },
        schemas,
      ),
  );
  await probe("P10", "Unknown remove path prevalidation", () =>
    SchemaValidator.validatePatchOperationValue(
      "remove",
      "notRegistered",
      undefined,
      schemas,
    ),
  );
  await probe("P11", "Required removal postvalidation", () =>
    validate({ schemas: [core, ext], userName: "x" }),
  );
  await probe("P12", "Primary update does not unset previous primary", () =>
    userApply(
      {
        items: [
          { type: "work", primary: true },
          { type: "home", primary: false },
        ],
      },
      [op('items[type eq "home"].primary', true)],
    ),
  );
  await probe("P13", "Verbose false materializes dot in core key", () =>
    userApply({ name: { givenName: "old" } }, [op("name.givenName", "new")], {
      verbosePatch: false,
    }),
  );
  await probe("P14", "Core complex replace merges sibling", () =>
    userApply({ name: { givenName: "old", familyName: "kept" } }, [
      op("name", { givenName: "new" }),
    ]),
  );
  await probe("P15", "No-path add overwrites existing multi-valued array", () =>
    userApply({ items: [{ value: "a" }] }, [
      { op: "add", value: { items: [{ value: "b" }] } },
    ]),
  );
  await probe(
    "P16",
    "Generic core valuePath treated as literal object path",
    () => {
      const p = new GenericPatchEngine(
        { items: [{ type: "work", value: "a" }] },
        [ext],
      );
      p.apply(op('items[type eq "work"].value', "b"));
      return p.getResult();
    },
  );
  await probe("P17", "Generic add core array concatenates", () => {
    const p = new GenericPatchEngine({ items: [{ value: "a" }] }, [ext]);
    p.apply(op("items", [{ value: "b" }], "add"));
    return p.getResult();
  });
  await probe("P18", "Group add displayName routes to members handling", () =>
    GroupPatchEngine.apply(
      [op("displayName", "new", "add")],
      { displayName: "old", externalId: null, members: [], rawPayload: {} },
      {
        extensionUrns: [ext],
        allowMultiMemberAdd: true,
        allowMultiMemberRemove: true,
        allowRemoveAllMembers: true,
      },
    ),
  );
  await probe("P19", "DateTime invalid calendar values", () =>
    SchemaValidator.validate(
      { when: "2026-99-99T99:99:99Z" },
      [
        {
          id: core,
          isCoreSchema: true,
          attributes: [attr("when", "dateTime")],
        },
      ],
      { strictMode: true, mode: "patch" },
    ),
  );
  await probe("P20", "Binary format only string checked", () =>
    SchemaValidator.validate(
      { blob: "not base64 ???" },
      [{ id: core, isCoreSchema: true, attributes: [attr("blob", "binary")] }],
      { strictMode: true, mode: "patch" },
    ),
  );
  await probe("P21", "referenceTypes only string checked", () =>
    SchemaValidator.validate(
      { link: "not a URI" },
      [
        {
          id: core,
          isCoreSchema: true,
          attributes: [
            attr("link", "reference", { referenceTypes: ["external"] }),
          ],
        },
      ],
      { strictMode: true, mode: "patch" },
    ),
  );
  await probe(
    "P22",
    "CaseExact canonicalValues compares case-insensitively",
    () =>
      SchemaValidator.validate(
        { label: "UPPER" },
        [
          {
            id: core,
            isCoreSchema: true,
            attributes: [
              attr("label", "string", {
                caseExact: true,
                canonicalValues: ["upper"],
              }),
            ],
          },
        ],
        { strictMode: true, mode: "patch" },
      ),
  );
  await probe("P23", "Extension validation duplicate errors", () =>
    validate({
      schemas: [core, ext],
      [ext]: { "contacts[primary eq true]": { value: "new" } },
    }),
  );
  await probe("P24", "Scalar extension namespace is ignored", () =>
    validate({ schemas: [core, ext], [ext]: "not-object" }),
  );
  await probe(
    "P25",
    "Uppercase declared schema URN in direct strict validator",
    () => validate({ schemas: [core.toUpperCase()], userName: "x" }),
  );
  await probe(
    "P26",
    "Malformed attr schema type accepted in admin expansion",
    () =>
      validateAndExpandProfile({
        schemas: [
          {
            id: "urn:example:custom:Device",
            name: "Device",
            attributes: [{ name: "x", type: "typo" }],
          },
        ],
        resourceTypes: [
          {
            id: "Device",
            name: "Device",
            endpoint: "/Devices",
            schema: "urn:example:custom:Device",
            schemaExtensions: [],
          },
        ],
      }),
  );
  const logger = new Proxy({}, { get: () => () => {} });
  const registry = new ScimSchemaRegistry(logger);
  await registry.onModuleInit();
  const context = new EndpointContextStorage();
  const repo = new InMemoryUserRepository();
  const service = new EndpointScimUsersService(
    repo,
    new ScimMetadataService(),
    logger,
    registry,
    context,
    { emit: () => {} },
  );
  const profile = {
    schemas,
    resourceTypes: [
      {
        id: "User",
        name: "User",
        schema: core,
        endpoint: "/Users",
        schemaExtensions: [{ schema: ext, required: false }],
      },
    ],
    serviceProviderConfig: {
      etag: { supported: true },
      filter: { supported: true, maxResults: 200 },
    },
    settings: { StrictSchemaValidation: true, PrimaryEnforcement: "reject" },
  };
  const run = (fn, settings = profile.settings) =>
    context.run(
      {
        endpointId: "synthetic",
        baseUrl: "https://example.test/scim/v2",
        profile: { ...profile, settings },
        config: settings,
      },
      fn,
    );
  const create = () =>
    run(() =>
      service.createUserForEndpoint(
        {
          schemas: [core, ext],
          userName: `probe-${rows.length}`,
          requiredCustom: "required",
          [ext]: {
            mandatory: "required",
            contacts: [{ primary: true, value: "old" }],
          },
        },
        "https://example.test/scim/v2",
        "synthetic",
        profile.settings,
      ),
    );
  const resource = await create();
  await probe(
    "P27",
    "Strict full service incident with InMemory write unchanged",
    async () => {
      try {
        await run(() =>
          service.patchUserForEndpoint(
            resource.id,
            {
              schemas: [patchSchema],
              Operations: [op(`${ext}:contacts[primary eq true].value`, "new")],
            },
            "https://example.test/scim/v2",
            "synthetic",
            profile.settings,
          ),
        );
      } catch (e) {
        return {
          error: e.getResponse(),
          persisted: JSON.parse(
            (await repo.findByScimId("synthetic", resource.id)).rawPayload,
          ),
        };
      }
    },
  );
  await probe(
    "P28",
    "Lenient service then GET contains malformed extension key",
    async () => {
      const settings = { ...profile.settings, StrictSchemaValidation: false };
      await run(
        () =>
          service.patchUserForEndpoint(
            resource.id,
            {
              schemas: [patchSchema],
              Operations: [op(`${ext}:contacts[primary eq true].value`, "new")],
            },
            "https://example.test/scim/v2",
            "synthetic",
            settings,
          ),
        settings,
      );
      return run(
        () =>
          service.getUserForEndpoint(
            resource.id,
            "https://example.test/scim/v2",
            "synthetic",
            settings,
          ),
        settings,
      );
    },
  );
  const resource2 = await create();
  await probe("P29", "Full service required custom attribute removal", () =>
    run(() =>
      service.patchUserForEndpoint(
        resource2.id,
        {
          schemas: [patchSchema],
          Operations: [{ op: "remove", path: "requiredCustom" }],
        },
        "https://example.test/scim/v2",
        "synthetic",
        profile.settings,
      ),
    ),
  );
  const resource3 = await create();
  await probe(
    "P30",
    "Two concurrent same-version If-Match service writes",
    async () => {
      const both = await Promise.allSettled(
        ["a", "b"].map((v) =>
          run(() =>
            service.patchUserForEndpoint(
              resource3.id,
              { schemas: [patchSchema], Operations: [op(`${ext}:label`, v)] },
              "https://example.test/scim/v2",
              "synthetic",
              profile.settings,
              'W/"v1"',
            ),
          ),
        ),
      );
      return {
        outcomes: both.map((r) =>
          r.status === "fulfilled"
            ? { status: r.status, version: r.value.meta.version }
            : r.reason.getResponse?.(),
        ),
        storedVersion: (await repo.findByScimId("synthetic", resource3.id))
          .version,
      };
    },
  );
  await probe(
    "P31",
    "Concurrent duplicate username creates with InMemory",
    async () => {
      const body = {
        schemas: [core, ext],
        userName: "same-concurrent",
        requiredCustom: "r",
        [ext]: { mandatory: "m" },
      };
      const both = await Promise.allSettled(
        [1, 2].map(() =>
          run(() =>
            service.createUserForEndpoint(
              clone(body),
              "https://example.test/scim/v2",
              "synthetic",
              profile.settings,
            ),
          ),
        ),
      );
      return both.map((r) =>
        r.status === "fulfilled"
          ? { status: r.status, id: r.value.id }
          : { status: r.status, error: r.reason.getResponse?.() },
      );
    },
  );
  await probe(
    "P32",
    "Soft-delete-disabled rejects unrelated patch of inactive user",
    async () => {
      const settings = {
        StrictSchemaValidation: false,
        UserSoftDeleteEnabled: false,
      };
      const r = await run(
        () =>
          service.createUserForEndpoint(
            {
              schemas: [core, ext],
              userName: "inactive",
              requiredCustom: "r",
              active: false,
              [ext]: { mandatory: "m" },
            },
            "https://example.test/scim/v2",
            "synthetic",
            settings,
          ),
        settings,
      );
      return run(
        () =>
          service.patchUserForEndpoint(
            r.id,
            {
              schemas: [patchSchema],
              Operations: [op(`${ext}:label`, "unrelated")],
            },
            "https://example.test/scim/v2",
            "synthetic",
            settings,
          ),
        settings,
      );
    },
  );
  const withAttr = (a) => ({
    ...profile,
    schemas: [
      { ...schemas[0], attributes: [...schemas[0].attributes, a] },
      schemas[1],
    ],
  });
  const runProfile = (p, fn) =>
    context.run(
      {
        endpointId: "synthetic",
        baseUrl: "https://example.test/scim/v2",
        profile: p,
        config: p.settings,
      },
      fn,
    );
  await probe("P33", "Immutable delete on full service", async () => {
    const p = withAttr(attr("serial", "string", { mutability: "immutable" }));
    return runProfile(p, async () => {
      const r = await service.createUserForEndpoint(
        {
          schemas: [core, ext],
          userName: "immutable-delete",
          requiredCustom: "r",
          serial: "first",
          [ext]: { mandatory: "m" },
        },
        "https://example.test/scim/v2",
        "synthetic",
        p.settings,
      );
      return service.patchUserForEndpoint(
        r.id,
        {
          schemas: [patchSchema],
          Operations: [{ op: "remove", path: "serial" }],
        },
        "https://example.test/scim/v2",
        "synthetic",
        p.settings,
      );
    });
  });
  await probe(
    "P34",
    "Sequential immutable assignment twice in one request",
    async () => {
      const p = withAttr(attr("serial", "string", { mutability: "immutable" }));
      return runProfile(p, async () => {
        const r = await service.createUserForEndpoint(
          {
            schemas: [core, ext],
            userName: "immutable-sequence",
            requiredCustom: "r",
            [ext]: { mandatory: "m" },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
        return service.patchUserForEndpoint(
          r.id,
          {
            schemas: [patchSchema],
            Operations: [op("serial", "first", "add"), op("serial", "second")],
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
      });
    },
  );
  await probe("P35", "Primary handoff full service reject mode", async () => {
    const r = await run(() =>
      service.createUserForEndpoint(
        {
          schemas: [core, ext],
          userName: "primary-handoff",
          requiredCustom: "r",
          items: [
            { type: "work", primary: true },
            { type: "home", primary: false },
          ],
          [ext]: { mandatory: "m" },
        },
        "https://example.test/scim/v2",
        "synthetic",
        profile.settings,
      ),
    );
    return run(() =>
      service.patchUserForEndpoint(
        r.id,
        {
          schemas: [patchSchema],
          Operations: [op('items[type eq "home"].primary', true)],
        },
        "https://example.test/scim/v2",
        "synthetic",
        profile.settings,
      ),
    );
  });
  await probe(
    "P36",
    "Filtering on hidden extension attribute uses projected data",
    async () => {
      const p = withAttr(attr("hidden", "string", { returned: "never" }));
      return runProfile(p, async () => {
        await service.createUserForEndpoint(
          {
            schemas: [core, ext],
            userName: "hidden-filter",
            requiredCustom: "r",
            hidden: "match",
            [ext]: { mandatory: "m" },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
        const result = await service.listUsersForEndpoint(
          { filter: 'hidden eq "match"' },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
        return { totalResults: result.totalResults };
      });
    },
  );
  const { EndpointScimGenericService } = load(
    "modules/scim/services/endpoint-scim-generic.service.ts",
  );
  const { InMemoryGenericResourceRepository } = load(
    "infrastructure/repositories/inmemory/inmemory-generic-resource.repository.ts",
  );
  const { EndpointScimGenericController } = load(
    "modules/scim/controllers/endpoint-scim-generic.controller.ts",
  );
  const genericRepo = new InMemoryGenericResourceRepository();
  const generic = new EndpointScimGenericService(
    genericRepo,
    new ScimMetadataService(),
    logger,
    registry,
    context,
    { emit: () => {} },
  );
  const deviceUrn = "urn:example:custom:Device";
  const deviceRt = {
    id: "Device",
    name: "Device",
    schema: deviceUrn,
    endpoint: "/Devices",
    schemaExtensions: [],
  };
  const deviceProfile = {
    schemas: [
      {
        id: deviceUrn,
        attributes: [attr("displayName", "string"), attr("cost", "integer")],
      },
    ],
    resourceTypes: [deviceRt],
    serviceProviderConfig: {
      patch: { supported: false },
      filter: { supported: false, maxResults: 1 },
      sort: { supported: false },
      etag: { supported: false },
    },
    settings: { StrictSchemaValidation: true, RequireIfMatch: true },
  };
  const deviceRun = (fn) =>
    context.run(
      {
        endpointId: "synthetic",
        baseUrl: "https://example.test/scim/v2",
        profile: deviceProfile,
        config: deviceProfile.settings,
      },
      fn,
    );
  const devices = [];
  for (const cost of [2, 10])
    devices.push(
      await deviceRun(() =>
        generic.createResource(
          { schemas: [deviceUrn], displayName: `device-${cost}`, cost },
          "https://example.test/scim/v2",
          "synthetic",
          deviceRt,
          deviceProfile.settings,
        ),
      ),
    );
  await probe("P37", "Generic ignores endpoint filter maxResults", () =>
    deviceRun(() =>
      generic.listResources(
        { count: 10 },
        "https://example.test/scim/v2",
        "synthetic",
        deviceRt,
        deviceProfile.settings,
      ),
    ),
  );
  await probe("P38", "Generic numeric sorting is string sorting", async () => {
    const r = await deviceRun(() =>
      generic.listResources(
        { sortBy: "cost" },
        "https://example.test/scim/v2",
        "synthetic",
        deviceRt,
        deviceProfile.settings,
      ),
    );
    return r.Resources.map((x) => x.cost);
  });
  await probe(
    "P39",
    "Generic still requires If-Match with ETag capability false",
    () =>
      deviceRun(() =>
        generic.patchResource(
          devices[0].id,
          { schemas: [patchSchema], Operations: [op("cost", 3)] },
          "https://example.test/scim/v2",
          "synthetic",
          deviceRt,
          deviceProfile.settings,
        ),
      ),
  );
  await probe(
    "P40",
    "Generic core array add is correct primitive positive control",
    () => {
      const p = new GenericPatchEngine({ tags: ["a"] }, []);
      p.apply(op("tags", ["b"], "add"));
      return p.getResult();
    },
  );
  await probe(
    "P41",
    "POST readOnly attribute validation occurs before ignore",
    async () => {
      const p = withAttr(
        attr("computed", "string", { mutability: "readOnly" }),
      );
      return runProfile(p, () =>
        service.createUserForEndpoint(
          {
            schemas: [core, ext],
            userName: "readonly-post",
            requiredCustom: "r",
            computed: "client",
            [ext]: { mandatory: "m" },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        ),
      );
    },
  );
  await probe(
    "P42",
    "Service PUT omitted immutable drops existing value",
    async () => {
      const p = withAttr(attr("serial", "string", { mutability: "immutable" }));
      return runProfile(p, async () => {
        const r = await service.createUserForEndpoint(
          {
            schemas: [core, ext],
            userName: "immutable-put",
            requiredCustom: "r",
            serial: "first",
            [ext]: { mandatory: "m" },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
        return service.replaceUserForEndpoint(
          r.id,
          {
            schemas: [core, ext],
            userName: "immutable-put",
            requiredCustom: "r",
            [ext]: { mandatory: "m" },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
      });
    },
  );
  await probe("P43", "No-op duplicate add metadata behavior", async () => {
    const r = await create();
    const result = await run(() =>
      service.patchUserForEndpoint(
        r.id,
        {
          schemas: [patchSchema],
          Operations: [op("requiredCustom", "required", "add")],
        },
        "https://example.test/scim/v2",
        "synthetic",
        profile.settings,
      ),
    );
    return { before: r.meta, after: result.meta };
  });
  await probe(
    "P44",
    "Exact four incident paths with a minimal synthetic schema and local data",
    async () => {
      const fixture = require("./incident-fixture.cjs");
      const p = clone(fixture.profile);
      const { google, contoso } = fixture;
      return runProfile(p, async () => {
        const r = await service.createUserForEndpoint(
          {
            schemas: [core, google, contoso],
            userName: "synthetic-four-path",
            name: {
              formatted: "Synthetic Probe",
              givenName: "Synthetic",
              familyName: "Probe",
            },
            active: true,
            [google]: {
              primaryOrganization: { location: "old" },
              additionalOrganizations: [
                { type: "school", symbol: "old" },
                { type: "work", symbol: "old" },
              ],
            },
            [contoso]: { contacts: [{ primary: true, value: "old" }] },
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        );
        const operations = clone(fixture.operations);
        let strictError;
        try {
          await service.patchUserForEndpoint(
            r.id,
            { schemas: [patchSchema], Operations: clone(operations) },
            "https://example.test/scim/v2",
            "synthetic",
            p.settings,
          );
        } catch (e) {
          strictError = e.getResponse();
        }
        const strictStored = JSON.parse(
          (await repo.findByScimId("synthetic", r.id)).rawPayload,
        );
        await service.patchUserForEndpoint(
          r.id,
          { schemas: [patchSchema], Operations: clone(operations) },
          "https://example.test/scim/v2",
          "synthetic",
          { ...p.settings, StrictSchemaValidation: false },
        );
        const after = await service.getUserForEndpoint(
          r.id,
          "https://example.test/scim/v2",
          "synthetic",
        );
        return { strictError, strictStored, after };
      });
    },
  );
  const endpointStub = {
    getEndpoint: async () => ({
      active: true,
      name: "synthetic",
      profile: deviceProfile,
    }),
  };
  const controller = new EndpointScimGenericController(
    endpointStub,
    context,
    generic,
  );
  const req = {
    protocol: "https",
    get: () => "example.test",
    headers: {},
    baseUrl: "/scim",
    originalUrl: "/scim/v2/endpoints/synthetic/Devices",
    url: "/scim/v2/endpoints/synthetic/Devices",
  };
  await probe(
    "P45",
    "Generic controller accepts filter although advertised false",
    () =>
      deviceRun(() =>
        controller.listResources("synthetic", "Devices", req, "cost eq 2"),
      ),
  );
  await probe("P46", "Generic .search array-valued attributes contract", () =>
    deviceRun(() =>
      controller.searchResources(
        "synthetic",
        "Devices",
        {
          schemas: ["urn:ietf:params:scim:api:messages:2.0:SearchRequest"],
          attributes: ["cost"],
        },
        req,
      ),
    ),
  );
  await probe(
    "P47",
    "Shape validator all eight top-level types single and multiple",
    () => {
      const values = {
        string: "s",
        boolean: true,
        integer: 7,
        decimal: 7.5,
        dateTime: "2026-09-25T12:00:00Z",
        binary: "YQ==",
        reference: "https://example.test/Users/a",
        complex: { value: "x" },
      };
      return Object.entries(values).flatMap(([type, value]) =>
        [false, true].map((multiValued) => {
          const definition = {
            id: "urn:example:core:Shape",
            isCoreSchema: true,
            attributes: [
              attr("a", type, {
                multiValued,
                ...(type === "complex"
                  ? { subAttributes: [attr("value", "string")] }
                  : {}),
              }),
            ],
          };
          const result = SchemaValidator.validate(
            { a: multiValued ? [value] : value },
            [definition],
            { strictMode: true, mode: "create" },
          );
          return { type, multiValued, valid: result.valid };
        }),
      );
    },
  );
  await probe(
    "P48",
    "Required ResourceType schema extension absent on POST",
    async () => {
      const p = {
        ...profile,
        resourceTypes: [
          {
            ...profile.resourceTypes[0],
            schemaExtensions: [{ schema: ext, required: true }],
          },
        ],
      };
      return runProfile(p, () =>
        service.createUserForEndpoint(
          {
            schemas: [core],
            userName: "missing-required-extension",
            requiredCustom: "r",
          },
          "https://example.test/scim/v2",
          "synthetic",
          p.settings,
        ),
      );
    },
  );
  await probe(
    "P49",
    "Uniqueness collector skips promoted-name extension and multi-valued leaves",
    () =>
      SchemaValidator.collectUniqueAttributes([
        {
          id: ext,
          attributes: [
            attr("externalId", "string", { uniqueness: "server" }),
            attr("displayName", "string", { uniqueness: "server" }),
            attr("aliases", "string", {
              uniqueness: "server",
              multiValued: true,
            }),
            attr("customUnique", "string", { uniqueness: "server" }),
          ],
        },
      ]),
  );
  await probe(
    "P50",
    "Unsupported boolean compound filter accepted as no-op core patch",
    () =>
      userApply({ items: [{ type: "work", primary: true, value: "old" }] }, [
        op('items[type eq "work" and primary eq true].value', "new"),
      ]),
  );
  if (rows.length !== 50)
    throw new Error(`Expected 50 observations, received ${rows.length}`);
  fs.writeFileSync(
    path.join(OUTPUT, "observations.json"),
    JSON.stringify(
      {
        base: BASE,
        backend:
          "production pure functions and real InMemory repository/service",
        fixtureNote:
          "P44 uses a minimal synthetic profile; original live-profile observation remains in characterization.json.",
        results: rows,
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(OUTPUT, "settings-source.json"),
    JSON.stringify(
      Object.entries(ENDPOINT_CONFIG_FLAGS_DEFINITIONS).map(([symbol, d]) => ({
        symbol,
        ...d,
        default: d.default ?? "inherit/unset",
      })),
      null,
      2,
    ),
  );
  for (const row of rows)
    console.log(row.id, row.purpose, row.error ? "THREW" : "OBSERVED");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
