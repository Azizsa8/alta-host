CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "logoFileId" TEXT,
    "wordmark" TEXT NOT NULL DEFAULT '',
    "primaryColor" TEXT NOT NULL DEFAULT '#E4177E',
    "secondaryColor" TEXT NOT NULL DEFAULT '#C9A227',
    "inkColor" TEXT NOT NULL DEFAULT '#0E0B14',
    "fontFamily" TEXT NOT NULL DEFAULT 'Readex Pro',
    "photoLayout" JSONB NOT NULL DEFAULT '{}',
    "videoSequence" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrandKit_propertyId_key" ON "BrandKit"("propertyId");
CREATE INDEX "BrandKit_tenantId_idx" ON "BrandKit"("tenantId");

CREATE TABLE "BrandRender" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sourceFileIds" JSONB NOT NULL DEFAULT '[]',
    "outputFileId" TEXT,
    "spec" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT NOT NULL DEFAULT '',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BrandRender_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BrandRender_propertyId_channel_createdAt_idx" ON "BrandRender"("propertyId", "channel", "createdAt");
CREATE INDEX "BrandRender_tenantId_idx" ON "BrandRender"("tenantId");

CREATE TRIGGER trg_tenant_brandkit BEFORE INSERT ON "BrandKit"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_brandrender BEFORE INSERT ON "BrandRender"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
