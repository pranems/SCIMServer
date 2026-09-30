const core = "urn:ietf:params:scim:schemas:core:2.0:User";
const google =
  "urn:ietf:params:scim:schemas:extension:google:2.0:CloudIdentityUser";
const contoso =
  "urn:ietf:params:scim:schemas:extension:contoso:2.0:ScalarMVUser";
const attribute = (name, type, extra = {}) => ({
  name,
  type,
  required: false,
  multiValued: false,
  mutability: "readWrite",
  returned: "default",
  ...extra,
});

// This is a synthetic minimal shape, not a saved or reconstructed private profile.
const profile = {
  schemas: [
    {
      id: core,
      attributes: [
        attribute("userName", "string", { required: true }),
        attribute("active", "boolean"),
        attribute("name", "complex", {
          required: true,
          subAttributes: [
            attribute("formatted", "string"),
            attribute("givenName", "string"),
            attribute("familyName", "string"),
          ],
        }),
      ],
    },
    {
      id: google,
      attributes: [
        attribute("primaryOrganization", "complex", {
          subAttributes: [attribute("location", "string")],
        }),
        attribute("additionalOrganizations", "complex", {
          multiValued: true,
          subAttributes: [
            attribute("type", "string", {
              canonicalValues: ["school", "work"],
            }),
            attribute("symbol", "string"),
          ],
        }),
      ],
    },
    {
      id: contoso,
      attributes: [
        attribute("contacts", "complex", {
          multiValued: true,
          subAttributes: [
            attribute("primary", "boolean"),
            attribute("value", "string"),
          ],
        }),
      ],
    },
  ],
  resourceTypes: [
    {
      id: "User",
      name: "User",
      endpoint: "/Users",
      schema: core,
      schemaExtensions: [
        { schema: google, required: false },
        { schema: contoso, required: false },
      ],
    },
  ],
  serviceProviderConfig: { etag: { supported: true } },
  settings: {
    StrictSchemaValidation: true,
    VerbosePatchSupported: true,
    PrimaryEnforcement: "reject",
  },
};
const operations = [
  `${google}:primaryOrganization.location`,
  `${google}:additionalOrganizations[type eq "school"].symbol`,
  `${google}:additionalOrganizations[type eq "work"].symbol`,
  `${contoso}:contacts[primary eq true].value`,
].map((path) => ({ op: "replace", path, value: "synthetic-new" }));

module.exports = { profile, google, contoso, operations };
