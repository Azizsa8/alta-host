CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'linked',
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialAccount_propertyId_platform_key" ON "SocialAccount"("propertyId", "platform");
CREATE INDEX "SocialAccount_tenantId_idx" ON "SocialAccount"("tenantId");

CREATE TABLE "GoogleReview" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "topic" TEXT NOT NULL DEFAULT 'general',
    "draftReply" TEXT NOT NULL DEFAULT '',
    "replyStatus" TEXT NOT NULL DEFAULT 'none',
    "approvedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GoogleReview_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GoogleReview_propertyId_externalId_key" ON "GoogleReview"("propertyId", "externalId");
CREATE INDEX "GoogleReview_propertyId_replyStatus_idx" ON "GoogleReview"("propertyId", "replyStatus");
CREATE INDEX "GoogleReview_tenantId_idx" ON "GoogleReview"("tenantId");

CREATE TRIGGER trg_tenant_socialaccount BEFORE INSERT ON "SocialAccount"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_googlereview BEFORE INSERT ON "GoogleReview"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
