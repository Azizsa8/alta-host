CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "propertyId" TEXT NOT NULL,
    "ticketId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'new',
    "assigneeId" TEXT,
    "location" TEXT NOT NULL,
    "checklist" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "closedBy" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkOrder_propertyId_status_idx" ON "WorkOrder"("propertyId", "status");
CREATE INDEX "WorkOrder_assigneeId_status_idx" ON "WorkOrder"("assigneeId", "status");
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

CREATE TABLE "WorkOrderUpdate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL DEFAULT '',
    "workOrderId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "photoFileIds" JSONB NOT NULL DEFAULT '[]',
    "statusTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkOrderUpdate_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WorkOrderUpdate_workOrderId_idx" ON "WorkOrderUpdate"("workOrderId");
CREATE INDEX "WorkOrderUpdate_tenantId_idx" ON "WorkOrderUpdate"("tenantId");
ALTER TABLE "WorkOrderUpdate" ADD CONSTRAINT "WorkOrderUpdate_workOrderId_fkey"
  FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER trg_tenant_workorder BEFORE INSERT ON "WorkOrder"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();

-- WorkOrderUpdate has no propertyId column — derive through its parent WO.
CREATE OR REPLACE FUNCTION derive_tenant_from_workorder() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" = '' THEN
    SELECT w."tenantId" INTO NEW."tenantId" FROM "WorkOrder" w WHERE w."id" = NEW."workOrderId";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenant_workorderupdate BEFORE INSERT ON "WorkOrderUpdate"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_workorder();
