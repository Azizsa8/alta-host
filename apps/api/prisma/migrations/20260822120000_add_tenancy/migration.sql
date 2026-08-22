-- Tenancy foundation (brief §2/§10): Tenant root + tenantId on every
-- business table, backfilled, then kept correct by BEFORE INSERT triggers
-- that derive the value from the parent row. Triggers make isolation a
-- property of the database, not of every write site remembering.

CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'basic',
    "status" TEXT NOT NULL DEFAULT 'active',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Riyadh',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "quotaGb" INTEGER NOT NULL DEFAULT 10,
    "usedBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- One tenant per existing property.
ALTER TABLE "Property" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
INSERT INTO "Tenant" ("id", "name")
  SELECT 'tnt-' || "id", "name" FROM "Property";
UPDATE "Property" SET "tenantId" = 'tnt-' || "id";
ALTER TABLE "Property" ADD CONSTRAINT "Property_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id");
CREATE INDEX "Property_tenantId_idx" ON "Property"("tenantId");

-- tenantId on business tables, backfilled from the ownership chain.
ALTER TABLE "Guest"              ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Reservation"        ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "StaffMember"        ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Conversation"       ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Message"            ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Intent"             ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Ticket"             ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AgentAction"        ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "ReviewItem"         ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Review"             ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "PropertyCredential" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AltaEvent"          ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AuditEvent"         ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT '';

UPDATE "Guest" g SET "tenantId" = p."tenantId" FROM "Property" p WHERE g."propertyId" = p."id";
UPDATE "Reservation" r SET "tenantId" = p."tenantId" FROM "Property" p WHERE r."propertyId" = p."id";
UPDATE "StaffMember" s SET "tenantId" = p."tenantId" FROM "Property" p WHERE s."propertyId" = p."id";
UPDATE "Review" v SET "tenantId" = p."tenantId" FROM "Property" p WHERE v."propertyId" = p."id";
UPDATE "PropertyCredential" c SET "tenantId" = p."tenantId" FROM "Property" p WHERE c."propertyId" = p."id";
UPDATE "Conversation" c SET "tenantId" = g."tenantId" FROM "Guest" g WHERE c."guestId" = g."id";
UPDATE "Message" m SET "tenantId" = c."tenantId" FROM "Conversation" c WHERE m."conversationId" = c."id";
UPDATE "Intent" i SET "tenantId" = m."tenantId" FROM "Message" m WHERE i."messageId" = m."id";
UPDATE "Ticket" t SET "tenantId" = i."tenantId" FROM "Intent" i WHERE t."intentId" = i."id";
UPDATE "ReviewItem" ri SET "tenantId" = i."tenantId" FROM "Intent" i WHERE ri."intentId" = i."id";
UPDATE "AgentAction" a SET "tenantId" = t."tenantId" FROM "Ticket" t WHERE a."ticketId" = t."id";
UPDATE "AltaEvent" e SET "tenantId" = p."tenantId" FROM "Property" p WHERE e."propertyId" = p."id";
UPDATE "AuditEvent" e SET "tenantId" = p."tenantId" FROM "Property" p WHERE e."propertyId" = p."id";

CREATE INDEX "Guest_tenantId_idx"        ON "Guest"("tenantId");
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");
CREATE INDEX "Message_tenantId_idx"      ON "Message"("tenantId");
CREATE INDEX "Ticket_tenantId_idx"       ON "Ticket"("tenantId");
CREATE INDEX "ReviewItem_tenantId_idx"   ON "ReviewItem"("tenantId");
CREATE INDEX "AltaEvent_tenantId_idx"    ON "AltaEvent"("tenantId");
CREATE INDEX "AuditEvent_tenantId_idx"   ON "AuditEvent"("tenantId");

-- ---- derivation triggers ------------------------------------------------

-- A property created without a tenant auto-provisions one, so onboarding
-- and legacy code paths cannot produce an orphan property.
CREATE OR REPLACE FUNCTION derive_tenant_property() RETURNS trigger AS $$
DECLARE tid TEXT;
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    tid := 'tnt-' || NEW."id";
    INSERT INTO "Tenant" ("id", "name") VALUES (tid, NEW."name")
      ON CONFLICT ("id") DO NOTHING;
    NEW."tenantId" := tid;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_property BEFORE INSERT ON "Property"
  FOR EACH ROW EXECUTE FUNCTION derive_tenant_property();

CREATE OR REPLACE FUNCTION derive_tenant_from_property() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Property" WHERE "id" = NEW."propertyId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_guest  BEFORE INSERT ON "Guest"              FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_resv   BEFORE INSERT ON "Reservation"        FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_staff  BEFORE INSERT ON "StaffMember"        FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_review BEFORE INSERT ON "Review"             FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_cred   BEFORE INSERT ON "PropertyCredential" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();
CREATE TRIGGER trg_tenant_evt    BEFORE INSERT ON "AltaEvent"          FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_property();

CREATE OR REPLACE FUNCTION derive_tenant_audit() RETURNS trigger AS $$
BEGIN
  IF (NEW."tenantId" IS NULL OR NEW."tenantId" = '') AND NEW."propertyId" IS NOT NULL THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Property" WHERE "id" = NEW."propertyId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION derive_tenant_audit();

CREATE OR REPLACE FUNCTION derive_tenant_from_guest() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Guest" WHERE "id" = NEW."guestId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_conv BEFORE INSERT ON "Conversation" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_guest();

CREATE OR REPLACE FUNCTION derive_tenant_from_conversation() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Conversation" WHERE "id" = NEW."conversationId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_msg BEFORE INSERT ON "Message" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_conversation();

CREATE OR REPLACE FUNCTION derive_tenant_from_message() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Message" WHERE "id" = NEW."messageId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_intent BEFORE INSERT ON "Intent" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_message();

CREATE OR REPLACE FUNCTION derive_tenant_from_intent() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Intent" WHERE "id" = NEW."intentId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_ticket BEFORE INSERT ON "Ticket"     FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_intent();
CREATE TRIGGER trg_tenant_ri     BEFORE INSERT ON "ReviewItem" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_intent();

CREATE OR REPLACE FUNCTION derive_tenant_from_ticket() RETURNS trigger AS $$
BEGIN
  IF NEW."tenantId" IS NULL OR NEW."tenantId" = '' THEN
    SELECT "tenantId" INTO NEW."tenantId" FROM "Ticket" WHERE "id" = NEW."ticketId";
    NEW."tenantId" := COALESCE(NEW."tenantId", '');
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_tenant_aa BEFORE INSERT ON "AgentAction" FOR EACH ROW EXECUTE FUNCTION derive_tenant_from_ticket();
