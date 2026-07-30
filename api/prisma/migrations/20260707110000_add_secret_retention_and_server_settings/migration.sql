-- WI-7: retained-secret column on EndpointCredential + server-global settings.

-- AlterTable: retained secret (DEK-encrypted envelope); null unless CredentialSecretVisibility=always
ALTER TABLE "EndpointCredential" ADD COLUMN "secretEnvelope" TEXT;

-- CreateTable: server-global key/value settings (seeds credentialSecretVisibility=always)
CREATE TABLE "ServerSetting" (
    "key" VARCHAR(128) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ServerSetting_pkey" PRIMARY KEY ("key")
);

-- Seed the server-scope CredentialSecretVisibility to the retain-friendly default.
INSERT INTO "ServerSetting" ("key", "value") VALUES ('credentialSecretVisibility', 'always');
