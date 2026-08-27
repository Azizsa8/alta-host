CREATE TABLE "SocialChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "handle" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoPublish" BOOLEAN NOT NULL DEFAULT false,
    "postsPerWeek" INTEGER NOT NULL DEFAULT 3,
    "bestTimes" JSONB NOT NULL DEFAULT '[]',
    "tone" TEXT NOT NULL DEFAULT '',
    "hashtags" JSONB NOT NULL DEFAULT '[]',
    "audienceNote" TEXT NOT NULL DEFAULT '',
    "lastSyncedAt" TIMESTAMP(3),
    "followers" INTEGER NOT NULL DEFAULT 0,
    "reach30d" INTEGER NOT NULL DEFAULT 0,
    "engagement30d" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SocialChannel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SocialChannel_propertyId_channel_key" ON "SocialChannel"("propertyId", "channel");
CREATE INDEX "SocialChannel_tenantId_idx" ON "SocialChannel"("tenantId");

CREATE TABLE "ComplaintCase" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "guestId" TEXT,
    "conversationId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'whatsapp',
    "text" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'general',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "reputationRisk" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'open',
    "rcaWhy" JSONB NOT NULL DEFAULT '[]',
    "rootCause" TEXT NOT NULL DEFAULT '',
    "contributing" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "preventive" TEXT NOT NULL DEFAULT '',
    "ownerId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT NOT NULL DEFAULT '',
    "publicReviewId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ComplaintCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ComplaintCase_propertyId_status_idx" ON "ComplaintCase"("propertyId", "status");
CREATE INDEX "ComplaintCase_propertyId_severity_idx" ON "ComplaintCase"("propertyId", "severity");
CREATE INDEX "ComplaintCase_tenantId_idx" ON "ComplaintCase"("tenantId");

CREATE TRIGGER trg_tenant_socialchannel BEFORE INSERT ON "SocialChannel"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_complaintcase BEFORE INSERT ON "ComplaintCase"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
