/*
  Warnings:

  - Added the required column `slaDeadline` to the `Ticket` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "escalatedAt" TIMESTAMP(3),
ADD COLUMN     "slaDeadline" TIMESTAMP(3);

-- Backfill existing demo rows so createdAt-based deadline still passes the
-- NOT NULL constraint we're about to add — these are disposable seed/demo
-- tickets, not real guest data, so "deadline = createdAt + 1h" is a
-- reasonable placeholder rather than something requiring judgment.
UPDATE "Ticket" SET "slaDeadline" = "createdAt" + INTERVAL '1 hour' WHERE "slaDeadline" IS NULL;

ALTER TABLE "Ticket" ALTER COLUMN "slaDeadline" SET NOT NULL;
