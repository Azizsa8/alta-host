CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "propertyId" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'success',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "prevHash" TEXT,
    "hash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");
CREATE INDEX "AuditEvent_propertyId_seq_idx" ON "AuditEvent"("propertyId", "seq");
CREATE INDEX "AuditEvent_actorId_seq_idx" ON "AuditEvent"("actorId", "seq");
CREATE INDEX "AuditEvent_action_seq_idx" ON "AuditEvent"("action", "seq");
