-- AlterTable
ALTER TABLE "StaffMember" ADD COLUMN "username" TEXT;
ALTER TABLE "StaffMember" ADD COLUMN "passwordHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "StaffMember_username_key" ON "StaffMember"("username");
