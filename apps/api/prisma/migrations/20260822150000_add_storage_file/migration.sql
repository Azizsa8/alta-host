CREATE TABLE "StorageFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trashedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StorageFile_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StorageFile_path_key" ON "StorageFile"("path");
CREATE INDEX "StorageFile_propertyId_kind_idx" ON "StorageFile"("propertyId", "kind");
CREATE INDEX "StorageFile_tenantId_idx" ON "StorageFile"("tenantId");
CREATE INDEX "StorageFile_status_trashedAt_idx" ON "StorageFile"("status", "trashedAt");
CREATE TRIGGER trg_tenant_storagefile BEFORE INSERT ON "StorageFile"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
