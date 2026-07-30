-- WI-6: per-install wrapped data-encryption-key (DEK).
-- CreateTable
CREATE TABLE "CredentialDek" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "wrappedDek" TEXT NOT NULL,
    "kekSalt" VARCHAR(255) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CredentialDek_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (fast lookup of the active DEK)
CREATE INDEX "CredentialDek_active_idx" ON "CredentialDek"("active");
