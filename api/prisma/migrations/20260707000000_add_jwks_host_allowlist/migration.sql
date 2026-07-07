-- WI-15: JWKS host allowlist persisted admin-editable layer.
-- CreateTable
CREATE TABLE "JwksHostAllowlistEntry" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "host" VARCHAR(255) NOT NULL,
    "label" VARCHAR(255),
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JwksHostAllowlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JwksHostAllowlistEntry_host_key" ON "JwksHostAllowlistEntry"("host");
