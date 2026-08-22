ALTER TABLE "Conversation" ADD COLUMN "aiPaused" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Conversation" ADD COLUMN "takenOverBy" TEXT;
ALTER TABLE "Conversation" ADD COLUMN "takenOverAt" TIMESTAMP(3);
