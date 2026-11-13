-- CreateEnum
CREATE TYPE "PayType" AS ENUM ('HOURLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "VenueMember" ADD COLUMN     "payRate" DECIMAL(10,2),
ADD COLUMN     "payType" "PayType",
ADD COLUMN     "position" TEXT;

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "position" TEXT,
    "notes" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "shiftId" TEXT,
    "clockIn" TIMESTAMP(3) NOT NULL,
    "clockOut" TIMESTAMP(3),
    "note" TEXT,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPayout" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "periodStart" TEXT NOT NULL,
    "periodEnd" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "venueId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Shift_venueId_date_idx" ON "Shift"("venueId", "date");

-- CreateIndex
CREATE INDEX "Shift_memberId_startTime_idx" ON "Shift"("memberId", "startTime");

-- CreateIndex
CREATE INDEX "TimeEntry_venueId_clockIn_idx" ON "TimeEntry"("venueId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_memberId_clockIn_idx" ON "TimeEntry"("memberId", "clockIn");

-- CreateIndex
CREATE INDEX "PayrollPayout_venueId_paidAt_idx" ON "PayrollPayout"("venueId", "paidAt");

-- CreateIndex
CREATE INDEX "PayrollPayout_memberId_periodStart_idx" ON "PayrollPayout"("memberId", "periodStart");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "VenueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "VenueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "VenueMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── Hand-written integrity rules ───────────────────────────────────────────
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_time_order" CHECK ("endTime" > "startTime");
-- One person can't be scheduled for two overlapping shifts.
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_no_overlap"
  EXCLUDE USING gist ("memberId" WITH =, tsrange("startTime", "endTime", '[)') WITH &&);

ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_time_order" CHECK ("clockOut" IS NULL OR "clockOut" > "clockIn");
-- At most one open (not yet clocked out) entry per person.
CREATE UNIQUE INDEX "TimeEntry_one_open" ON "TimeEntry" ("memberId") WHERE "clockOut" IS NULL;

ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "PayrollPayout" ADD CONSTRAINT "PayrollPayout_period" CHECK ("periodEnd" >= "periodStart");
ALTER TABLE "VenueMember" ADD CONSTRAINT "VenueMember_payRate_nonneg" CHECK ("payRate" IS NULL OR "payRate" >= 0);
