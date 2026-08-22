CREATE TABLE "BrandProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "identity" TEXT NOT NULL DEFAULT '',
    "services" JSONB NOT NULL DEFAULT '[]',
    "offers" JSONB NOT NULL DEFAULT '[]',
    "audience" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT 'ودّي واحترافي',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandProfile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandProfile_propertyId_key" ON "BrandProfile"("propertyId");
CREATE INDEX "BrandProfile_tenantId_idx" ON "BrandProfile"("tenantId");

CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "bodyAr" TEXT NOT NULL DEFAULT '',
    "bodyEn" TEXT NOT NULL DEFAULT '',
    "mediaFileIds" JSONB NOT NULL DEFAULT '[]',
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'idea',
    "approvedBy" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "resultUrl" TEXT NOT NULL DEFAULT '',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ContentItem_propertyId_status_idx" ON "ContentItem"("propertyId", "status");
CREATE INDEX "ContentItem_status_scheduledAt_idx" ON "ContentItem"("status", "scheduledAt");
CREATE INDEX "ContentItem_tenantId_idx" ON "ContentItem"("tenantId");

CREATE TRIGGER trg_tenant_brandprofile BEFORE INSERT ON "BrandProfile"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_contentitem BEFORE INSERT ON "ContentItem"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
