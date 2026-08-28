ALTER TABLE "SocialChannel"
  ADD COLUMN "connected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "connectedAt" TIMESTAMP(3),
  ADD COLUMN "connectedBy" TEXT,
  ADD COLUMN "accountRef" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "connectionError" TEXT NOT NULL DEFAULT '';
