-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('WALK_IN', 'PHONE', 'WHATSAPP', 'GAMEON', 'PLAYO', 'DISTRICT', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "priceOverridden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "sportId" TEXT;

-- AlterTable
ALTER TABLE "Venue" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourtBlock" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "courtId" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourtBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_venueId_receivedAt_idx" ON "Payment"("venueId", "receivedAt");

-- CreateIndex
CREATE INDEX "Payment_bookingId_idx" ON "Payment"("bookingId");

-- CreateIndex
CREATE INDEX "CourtBlock_courtId_startTime_idx" ON "CourtBlock"("courtId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_venueId_startTime_idx" ON "Booking"("venueId", "startTime");

-- CreateIndex
CREATE INDEX "Booking_courtId_startTime_idx" ON "Booking"("courtId", "startTime");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written: integrity constraints Prisma cannot express ───────────────

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"    ADD CONSTRAINT "Booking_time_order"    CHECK ("endTime" > "startTime");
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_time_order" CHECK ("endTime" > "startTime");
ALTER TABLE "Payment"    ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "Booking"    ADD CONSTRAINT "Booking_amount_nonneg"   CHECK ("amountUsd" >= 0);

-- A court can never hold two overlapping non-cancelled bookings. Half-open
-- ranges '[)' let a 10:00-11:00 booking sit next to an 11:00-12:00 one.
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist ("courtId" WITH =, tsrange("startTime", "endTime", '[)') WITH &&)
  WHERE (status <> 'CANCELLED');

ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_no_overlap"
  EXCLUDE USING gist ("courtId" WITH =, tsrange("startTime", "endTime", '[)') WITH &&);

-- ─── Hand-written: backfill (non-destructive) ────────────────────────────────

-- Link legacy bookings to the venue's Sport row when the name matches.
UPDATE "Booking" b SET "sportId" = s.id
FROM "Sport" s
WHERE b."sportId" IS NULL AND s."venueId" = b."venueId" AND lower(s.name) = lower(b.sport);

UPDATE "Booking" SET "cancelledAt" = "updatedAt" WHERE status = 'CANCELLED' AND "cancelledAt" IS NULL;

-- Existing PAID / REFUNDED bookings get matching payment records so collected
-- revenue (computed from Payment rows) agrees with their summary status.
INSERT INTO "Payment" (id, "bookingId", "venueId", kind, method, amount, "receivedAt", note)
SELECT 'bf_pay_' || b.id, b.id, b."venueId", 'PAYMENT', 'OTHER', b."amountUsd", b."startTime", 'Backfilled from legacy payment status'
FROM "Booking" b
WHERE b.payment IN ('PAID', 'REFUNDED') AND b."amountUsd" > 0;

INSERT INTO "Payment" (id, "bookingId", "venueId", kind, method, amount, "receivedAt", note)
SELECT 'bf_ref_' || b.id, b.id, b."venueId", 'REFUND', 'OTHER', b."amountUsd", COALESCE(b."cancelledAt", b."updatedAt"), 'Backfilled from legacy payment status'
FROM "Booking" b
WHERE b.payment = 'REFUNDED' AND b."amountUsd" > 0;
