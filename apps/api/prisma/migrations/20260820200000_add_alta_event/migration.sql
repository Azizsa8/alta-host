CREATE TABLE "AltaEvent" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "propertyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AltaEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AltaEvent_seq_key" ON "AltaEvent"("seq");
CREATE INDEX "AltaEvent_propertyId_seq_idx" ON "AltaEvent"("propertyId", "seq");
