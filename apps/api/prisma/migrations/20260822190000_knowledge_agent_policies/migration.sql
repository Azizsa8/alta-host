CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contentAr" TEXT NOT NULL,
    "contentEn" TEXT NOT NULL DEFAULT '',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "KnowledgeItem_propertyId_status_idx" ON "KnowledgeItem"("propertyId", "status");
CREATE INDEX "KnowledgeItem_tenantId_idx" ON "KnowledgeItem"("tenantId");

CREATE TABLE "AgentPolicy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AgentPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgentPolicy_propertyId_agentKey_key" ON "AgentPolicy"("propertyId", "agentKey");
CREATE INDEX "AgentPolicy_tenantId_idx" ON "AgentPolicy"("tenantId");

CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL,
    "intentId" TEXT,
    "intentType" TEXT NOT NULL,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "outputs" JSONB NOT NULL DEFAULT '{}',
    "tools" JSONB NOT NULL DEFAULT '[]',
    "policyApplied" TEXT NOT NULL DEFAULT 'enabled',
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentRun_propertyId_agentKey_createdAt_idx" ON "AgentRun"("propertyId", "agentKey", "createdAt");
CREATE INDEX "AgentRun_tenantId_idx" ON "AgentRun"("tenantId");

CREATE TRIGGER trg_tenant_knowledgeitem BEFORE INSERT ON "KnowledgeItem"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_agentpolicy BEFORE INSERT ON "AgentPolicy"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_agentrun BEFORE INSERT ON "AgentRun"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
