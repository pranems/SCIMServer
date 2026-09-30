const path = require("node:path");
const { API } = require("./safety.cjs");
const { getAuthToken } = require(
  path.join(API, "test", "e2e", "helpers", "auth.helper.ts"),
);
const flowTrace = require(
  path.join(API, "test", "e2e", "helpers", "flow-trace.helper.ts"),
);
const { PrismaService } = require(
  path.join(API, "src", "modules", "prisma", "prisma.service.ts"),
);

module.exports = function registerAliasCases({
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
  getApp,
  EXT,
  PATCH,
}) {
  const BULK = "urn:ietf:params:scim:api:messages:2.0:BulkRequest";
  const bulk = (ep, operations) =>
    http("post", `${ep.base}/Bulk`, {
      schemas: [BULK],
      failOnErrors: 0,
      Operations: operations,
    });
  const embeddedPatch = (resource, operations) => ({
    method: "PATCH",
    path: `/Users/${resource.body.id}`,
    version: resource.etag,
    data: { schemas: [PATCH], Operations: operations },
  });

  caseOf(
    "ALIAS-BULK-SUCCESS",
    "Direct and Bulk User mutation produce the same stored values",
    "HTTP direct versus Bulk + persisted readback",
    async (c) => {
      const ep = await endpoint();
      const direct = await create(ep, "Users", { [EXT]: { text: "before" } });
      const viaBulk = await create(ep, "Users", { [EXT]: { text: "before" } });
      const operations = [
        op(`${EXT}:text`, "same-result"),
        op("active", false),
      ];
      const directWrite = await patch(
        ep,
        "Users",
        direct.body.id,
        copy(operations),
        { "If-Match": direct.etag },
      );
      const bulkWrite = await bulk(ep, [
        embeddedPatch(viaBulk, copy(operations)),
      ]);
      const directRead = await http(
        "get",
        `${ep.base}/Users/${direct.body.id}`,
      );
      const aliasRead = await http(
        "get",
        `${ep.base}/Users/${viaBulk.body.id}`,
      );
      const directStored = await stored(ep, "Users", direct.body.id);
      const aliasStored = await stored(ep, "Users", viaBulk.body.id);
      c.observe("directWrite", directWrite);
      c.observe("bulkWrite", bulkWrite);
      c.observe("directRead", directRead);
      c.observe("aliasRead", aliasRead);
      c.observe("directStored", directStored);
      c.observe("aliasStored", aliasStored);
      c.check("direct mutation positive control", directWrite.status, 200);
      c.check("Bulk envelope accepted", bulkWrite.status, 200);
      c.check(
        "embedded PATCH success",
        bulkWrite.body.Operations?.[0]?.status,
        "200",
      );
      c.check(
        "both GETs succeed",
        [directRead.status, aliasRead.status],
        [200, 200],
      );
      c.check(
        "both intended values read back",
        [directRead.body[EXT]?.text, aliasRead.body[EXT]?.text],
        ["same-result", "same-result"],
      );
      c.check(
        "both active values read back",
        [directRead.body.active, aliasRead.body.active],
        [false, false],
      );
      c.check(
        "alias stored extension equals direct",
        aliasStored.payload[EXT],
        directStored.payload[EXT],
      );
      c.check(
        "both store the expected value",
        [directStored.payload[EXT]?.text, aliasStored.payload[EXT]?.text],
        ["same-result", "same-result"],
      );
      c.check(
        "both version increments",
        [directStored.version, aliasStored.version],
        [2, 2],
      );
      c.check(
        "Bulk reported version matches GET ETag",
        bulkWrite.body.Operations?.[0]?.version,
        aliasRead.etag,
      );
    },
  );

  caseOf(
    "ALIAS-BULK-ATOMICITY",
    "Failed embedded PATCH is atomic while another Bulk operation succeeds",
    "HTTP direct failure control versus Bulk + persisted state",
    async (c) => {
      const ep = await endpoint();
      const initial = {
        [EXT]: {
          text: "before",
          items: [{ type: "home", value: "unchanged" }],
        },
      };
      const direct = await create(ep, "Users", copy(initial));
      const target = await create(ep, "Users", copy(initial));
      const other = await create(ep, "Users", {
        [EXT]: { text: "other-before" },
      });
      const before = await stored(ep, "Users", target.body.id);
      const operations = [
        op(`${EXT}:text`, "must-rollback"),
        op(`${EXT}:items[type eq "missing"].value`, "no-target"),
      ];
      const directWrite = await patch(
        ep,
        "Users",
        direct.body.id,
        copy(operations),
      );
      const response = await bulk(ep, [
        embeddedPatch(target, copy(operations)),
        embeddedPatch(other, [op(`${EXT}:text`, "other-committed")]),
      ]);
      const after = await stored(ep, "Users", target.body.id);
      const directAfter = await stored(ep, "Users", direct.body.id);
      const otherAfter = await stored(ep, "Users", other.body.id);
      const read = await http("get", `${ep.base}/Users/${target.body.id}`);
      c.observe("directFailureControl", directWrite);
      c.observe("bulk", response);
      c.observe("targetBefore", before);
      c.observe("targetAfter", after);
      c.observe("otherAfter", otherAfter);
      c.observe("targetGet", read);
      c.check(
        "direct error control",
        [directWrite.status, directWrite.body.scimType],
        [400, "noTarget"],
      );
      c.check(
        "direct failed PATCH rolled back",
        directAfter.payload[EXT],
        initial[EXT],
      );
      c.check("Bulk remains a successful envelope", response.status, 200);
      c.check(
        "individual error and success statuses",
        response.body.Operations?.map((x) => x.status),
        ["400", "200"],
      );
      c.check(
        "embedded PATCH error retained",
        response.body.Operations?.[0]?.response?.scimType,
        "noTarget",
      );
      c.check(
        "failed target payload rolled back",
        after.payload,
        before.payload,
      );
      c.check("failed target version unchanged", after.version, before.version);
      c.check("failed target GET ETag unchanged", read.etag, target.etag);
      c.check(
        "subsequent independent operation commits",
        otherAfter.payload[EXT]?.text,
        "other-committed",
      );
      c.check(
        "subsequent operation increments its own version",
        otherAfter.version,
        2,
      );
    },
  );

  caseOf(
    "ALIAS-BULK-DISABLED",
    "Bulk must not bypass the endpoint's disabled PATCH capability",
    "HTTP discovery + direct guard control + Bulk persisted readback",
    async (c) => {
      const ep = await endpoint(profile({}, { patch: { supported: false } }));
      const direct = await create(ep, "Users", { [EXT]: { text: "before" } });
      const target = await create(ep, "Users", { [EXT]: { text: "before" } });
      const discovery = await http("get", `${ep.base}/ServiceProviderConfig`);
      const directWrite = await patch(ep, "Users", direct.body.id, [
        op(`${EXT}:text`, "blocked"),
      ]);
      const response = await bulk(ep, [
        embeddedPatch(target, [op(`${EXT}:text`, "blocked")]),
      ]);
      const directAfter = await stored(ep, "Users", direct.body.id);
      const aliasAfter = await stored(ep, "Users", target.body.id);
      c.observe("discovery", discovery);
      c.observe("directGuardControl", directWrite);
      c.observe("bulk", response);
      c.observe("directStored", directAfter);
      c.observe("aliasStored", aliasAfter);
      c.check(
        "discovery advertises PATCH disabled",
        discovery.body.patch?.supported,
        false,
      );
      c.check(
        "discovery advertises Bulk enabled",
        discovery.body.bulk?.supported,
        true,
      );
      c.check(
        "direct PATCH guard control rejects",
        directWrite.status >= 400,
        true,
      );
      c.check(
        "direct target remains unchanged",
        directAfter.payload[EXT]?.text,
        "before",
      );
      c.check("Bulk envelope is available", response.status, 200);
      c.check(
        "embedded disabled PATCH rejected",
        Number(response.body.Operations?.[0]?.status) >= 400,
        true,
      );
      c.check(
        "alias target remains unchanged",
        aliasAfter.payload[EXT]?.text,
        "before",
      );
      c.check("alias target version remains unchanged", aliasAfter.version, 1);
    },
  );

  caseOf(
    "ALIAS-ME-USER",
    "Synthetic OAuth /Me and direct User routes access and mutate the same user",
    "real local OAuth helper + HTTP alias + persisted readback",
    async (c) => {
      // The existing helper traces token responses; redact before that trace is persisted.
      const originalFinish = flowTrace.finishE2eFlowStep;
      const trace = jest
        .spyOn(flowTrace, "finishE2eFlowStep")
        .mockImplementation((started, output) => {
          originalFinish(
            {
              ...started,
              request: {
                ...started.request,
                body: {
                  grant_type: "client_credentials",
                  client_id: process.env.OAUTH_CLIENT_ID,
                  client_secret: "[REDACTED]",
                },
              },
            },
            {
              ...output,
              body: {
                token_type: output.body?.token_type,
                expires_in: output.body?.expires_in,
                access_token: "[REDACTED]",
              },
            },
          );
        });
      let token;
      try {
        token = await getAuthToken(getApp());
      } finally {
        trace.mockRestore();
      }
      const auth = { Authorization: `Bearer ${token}` };
      const ep = await endpoint();
      const user = await create(ep, "Users", {
        userName: process.env.OAUTH_CLIENT_ID,
        [EXT]: { text: "before" },
      });
      const directInitial = await http(
        "get",
        `${ep.base}/Users/${user.body.id}`,
        undefined,
        auth,
      );
      const meInitial = await http("get", `${ep.base}/Me`, undefined, auth);
      const legacyMe = await http("get", `${ep.base}/Me`);
      const directWrite = await patch(
        ep,
        "Users",
        user.body.id,
        [op(`${EXT}:text`, "direct"), op("active", false)],
        {
          ...auth,
          "If-Match": user.etag,
        },
      );
      const meAfterDirect = await http("get", `${ep.base}/Me`, undefined, auth);
      const meWrite = await http(
        "patch",
        `${ep.base}/Me`,
        {
          schemas: [PATCH],
          Operations: [op(`${EXT}:text`, "via-me")],
        },
        { ...auth, "If-Match": directWrite.etag ?? user.etag },
      );
      const directFinal = await http(
        "get",
        `${ep.base}/Users/${user.body.id}`,
        undefined,
        auth,
      );
      const meFinal = await http("get", `${ep.base}/Me`, undefined, auth);
      const finalStored = await stored(ep, "Users", user.body.id);
      c.observe("syntheticAuth", {
        subject: process.env.OAUTH_CLIENT_ID,
        helper: "getAuthToken/createTestApp",
        tokenPersistedInEvidence: false,
        helperTraceRedacted: true,
      });
      c.observe("directInitial", directInitial);
      c.observe("meInitial", meInitial);
      c.observe("legacyMe", legacyMe);
      c.observe("directWrite", directWrite);
      c.observe("meAfterDirect", meAfterDirect);
      c.observe("meWrite", meWrite);
      c.observe("directFinal", directFinal);
      c.observe("meFinal", meFinal);
      c.observe("stored", finalStored);
      c.check("OAuth direct-read positive control", directInitial.status, 200);
      c.check(
        "OAuth direct-read matches created User",
        directInitial.body.id,
        user.body.id,
      );
      c.check(
        "Me resolves same User",
        [meInitial.status, meInitial.body.id],
        [200, user.body.id],
      );
      c.check(
        "shared secret does not invent a Me identity",
        legacyMe.status,
        404,
      );
      c.check("direct OAuth mutation control", directWrite.status, 200);
      c.check(
        "Me sees direct mutation",
        [
          meAfterDirect.body.id,
          meAfterDirect.body[EXT]?.text,
          meAfterDirect.body.active,
        ],
        [user.body.id, "direct", false],
      );
      c.check("Me mutation succeeds", meWrite.status, 200);
      c.check(
        "direct and Me final GETs succeed",
        [directFinal.status, meFinal.status],
        [200, 200],
      );
      c.check("direct sees Me mutation", directFinal.body[EXT]?.text, "via-me");
      c.check("Me sees its mutation", meFinal.body[EXT]?.text, "via-me");
      c.check(
        "Me version equals direct User ETag",
        meFinal.etag,
        directFinal.etag,
      );
      c.check(
        "same stored User has final value",
        [
          finalStored.scimId,
          finalStored.payload[EXT]?.text,
          finalStored.active,
        ],
        [user.body.id, "via-me", false],
      );
      c.check(
        "two mutations increment same User version",
        finalStored.version,
        3,
      );
    },
  );

  caseOf(
    "ALIAS-DISCOVERY-REFLECTION",
    "Discovery reflects endpoint schema/capability changes and hide/restore setting",
    "HTTP admin changes + before/after public discovery + persisted profile",
    async (c) => {
      const ep = await endpoint();
      const beforeSchemas = await http("get", `${ep.base}/Schemas`);
      const beforeTypes = await http("get", `${ep.base}/ResourceTypes`);
      const beforeSpc = await http("get", `${ep.base}/ServiceProviderConfig`);
      const current = await http("get", `/scim/admin/endpoints/${ep.id}`);
      const edited = copy(current.body.profile);
      const newUrn = "urn:example:custom:AliasProbe";
      edited.schemas
        .find((s) => s.id === EXT)
        .attributes.push(attr("discoveryAdded", "string"));
      edited.schemas.push({
        id: newUrn,
        name: "AliasProbe",
        attributes: [attr("label", "string")],
      });
      edited.resourceTypes.push({
        id: "AliasProbe",
        name: "AliasProbe",
        endpoint: "/AliasProbes",
        schema: newUrn,
        schemaExtensions: [],
      });
      const changed = await http("patch", `/scim/admin/endpoints/${ep.id}`, {
        profile: {
          schemas: edited.schemas,
          resourceTypes: edited.resourceTypes,
          settings: { StrictSchemaValidation: false },
          serviceProviderConfig: { patch: { supported: false } },
        },
      });
      const afterSchemas = await http("get", `${ep.base}/Schemas`);
      const afterTypes = await http("get", `${ep.base}/ResourceTypes`);
      const afterSpc = await http("get", `${ep.base}/ServiceProviderConfig`);
      const afterAdmin = await http("get", `/scim/admin/endpoints/${ep.id}`);
      const persistedProfile =
        process.env.PERSISTENCE_BACKEND === "prisma"
          ? (
              await getApp()
                .get(PrismaService)
                .endpoint.findUnique({ where: { id: ep.id } })
            ).profile
          : afterAdmin.body.profile;
      const created = await http("post", `${ep.base}/AliasProbes`, {
        schemas: [newUrn],
        label: "synthetic-discovery",
      });
      const hidden = await http("patch", `/scim/admin/endpoints/${ep.id}`, {
        profile: { settings: { SchemaDiscoveryEnabled: false } },
      });
      const hiddenReads = await Promise.all(
        ["Schemas", "ResourceTypes", "ServiceProviderConfig"].map((p) =>
          http("get", `${ep.base}/${p}`),
        ),
      );
      const restored = await http("patch", `/scim/admin/endpoints/${ep.id}`, {
        profile: { settings: { SchemaDiscoveryEnabled: true } },
      });
      const restoredSchemas = await http("get", `${ep.base}/Schemas`);
      const selectSchema = (response) =>
        response.body.Resources?.find((s) => s.id === EXT);
      c.observe("before", {
        statuses: [beforeSchemas.status, beforeTypes.status, beforeSpc.status],
        extensionAttributes: selectSchema(beforeSchemas)?.attributes?.map(
          (a) => a.name,
        ),
        resourceTypes: beforeTypes.body.Resources?.map((r) => ({
          name: r.name,
          schema: r.schema,
          endpoint: r.endpoint,
        })),
        patchSupported: beforeSpc.body.patch?.supported,
        strictSchemaValidation:
          current.body.profile?.settings?.StrictSchemaValidation,
      });
      c.observe("after", {
        statuses: [
          changed.status,
          afterSchemas.status,
          afterTypes.status,
          afterSpc.status,
          afterAdmin.status,
        ],
        extensionAttributes: selectSchema(afterSchemas)?.attributes?.map(
          (a) => a.name,
        ),
        resourceTypes: afterTypes.body.Resources?.map((r) => ({
          name: r.name,
          schema: r.schema,
          endpoint: r.endpoint,
        })),
        patchSupported: afterSpc.body.patch?.supported,
        strictSchemaValidation:
          afterAdmin.body.profile?.settings?.StrictSchemaValidation,
        storedProfile: {
          source:
            process.env.PERSISTENCE_BACKEND === "prisma"
              ? "PostgreSQL Endpoint.profile"
              : "InMemory endpoint store",
          strictSchemaValidation:
            persistedProfile.settings.StrictSchemaValidation,
          patchSupported:
            persistedProfile.serviceProviderConfig.patch.supported,
          newSchemaPresent: persistedProfile.schemas.some(
            (s) => s.id === newUrn,
          ),
        },
        createdCustomResource: created,
      });
      c.observe("hideRestore", {
        updateStatuses: [hidden.status, restored.status],
        hiddenStatuses: hiddenReads.map((r) => r.status),
        restoredStatus: restoredSchemas.status,
      });
      c.check(
        "initial discovery positive control",
        [beforeSchemas.status, beforeTypes.status, beforeSpc.status],
        [200, 200, 200],
      );
      c.check(
        "new attribute initially absent",
        selectSchema(beforeSchemas)?.attributes?.some(
          (a) => a.name === "discoveryAdded",
        ),
        false,
      );
      c.check(
        "initial PATCH capability",
        beforeSpc.body.patch?.supported,
        true,
      );
      c.check("profile change accepted", changed.status, 200);
      c.check(
        "new attribute discovered",
        selectSchema(afterSchemas)?.attributes?.some(
          (a) => a.name === "discoveryAdded",
        ),
        true,
      );
      c.check(
        "new schema discovered",
        afterSchemas.body.Resources?.some((s) => s.id === newUrn),
        true,
      );
      c.check(
        "new ResourceType discovered",
        afterTypes.body.Resources?.find((r) => r.name === "AliasProbe")
          ?.endpoint,
        "/AliasProbes",
      );
      c.check(
        "new PATCH capability reflected",
        afterSpc.body.patch?.supported,
        false,
      );
      c.check(
        "changed setting reflected in admin profile",
        afterAdmin.body.profile?.settings?.StrictSchemaValidation,
        false,
      );
      c.check(
        "changed profile persisted",
        [
          persistedProfile.settings.StrictSchemaValidation,
          persistedProfile.serviceProviderConfig.patch.supported,
          persistedProfile.schemas.some((s) => s.id === newUrn),
        ],
        [false, false, true],
      );
      c.check("new route operational positive control", created.status, 201);
      c.check(
        "new route retains value",
        created.body.label,
        "synthetic-discovery",
      );
      c.check(
        "discovery hide/restore updates accepted",
        [hidden.status, restored.status],
        [200, 200],
      );
      c.check(
        "all endpoint discovery routes hidden",
        hiddenReads.map((r) => r.status),
        [404, 404, 404],
      );
      c.check("discovery restored", restoredSchemas.status, 200);
      c.check(
        "schema change retained after restore",
        selectSchema(restoredSchemas)?.attributes?.some(
          (a) => a.name === "discoveryAdded",
        ),
        true,
      );
    },
  );
};
