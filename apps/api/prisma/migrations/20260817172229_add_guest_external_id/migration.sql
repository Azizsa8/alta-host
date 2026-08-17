-- AlterTable
ALTER TABLE "Guest" ADD COLUMN "externalId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Guest_externalId_key" ON "Guest"("externalId");
