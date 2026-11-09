-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('REGISTRATION', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TournamentEntryType" AS ENUM ('SINGLES', 'DOUBLES', 'TEAM');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'COMPLETED');

-- AlterTable
ALTER TABLE "CourtBlock" ADD COLUMN     "tournamentId" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "tournamentEntryId" TEXT;

-- CreateTable
CREATE TABLE "Tournament" (
    "id" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sportId" TEXT,
    "courtIds" TEXT[],
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "entryType" "TournamentEntryType" NOT NULL DEFAULT 'SINGLES',
    "maxEntrants" INTEGER,
    "entryFee" DECIMAL(10,2) NOT NULL,
    "prizes" JSONB NOT NULL DEFAULT '[]',
    "status" "TournamentStatus" NOT NULL DEFAULT 'REGISTRATION',
    "winnerEntrantId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentEntrant" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "playerId" TEXT,
    "phone" TEXT,
    "seed" INTEGER,
    "withdrawn" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentEntrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentMatch" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "entrantAId" TEXT,
    "entrantBId" TEXT,
    "winnerId" TEXT,
    "score" TEXT,
    "courtId" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Tournament_venueId_status_idx" ON "Tournament"("venueId", "status");

-- CreateIndex
CREATE INDEX "TournamentEntrant_tournamentId_idx" ON "TournamentEntrant"("tournamentId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentMatch_tournamentId_round_position_key" ON "TournamentMatch"("tournamentId", "round", "position");

-- CreateIndex
CREATE INDEX "CourtBlock_tournamentId_startTime_idx" ON "CourtBlock"("tournamentId", "startTime");

-- CreateIndex
CREATE INDEX "Payment_tournamentEntryId_idx" ON "Payment"("tournamentEntryId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tournamentEntryId_fkey" FOREIGN KEY ("tournamentEntryId") REFERENCES "TournamentEntrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourtBlock" ADD CONSTRAINT "CourtBlock_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_sportId_fkey" FOREIGN KEY ("sportId") REFERENCES "Sport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntrant" ADD CONSTRAINT "TournamentEntrant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentEntrant" ADD CONSTRAINT "TournamentEntrant_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_entrantAId_fkey" FOREIGN KEY ("entrantAId") REFERENCES "TournamentEntrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_entrantBId_fkey" FOREIGN KEY ("entrantBId") REFERENCES "TournamentEntrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "TournamentEntrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Hand-written integrity checks ──────────────────────────────────────────
-- Payments may now also belong to a tournament entry; still exactly one target.
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_one_target";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_one_target"
  CHECK (num_nonnulls("bookingId", "membershipId", "enrollmentId", "tournamentEntryId") = 1);

ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_times" CHECK ("endMin" > "startMin" AND "startMin" >= 0 AND "endMin" <= 1440);
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_dates" CHECK ("endDate" >= "startDate");
ALTER TABLE "Tournament" ADD CONSTRAINT "Tournament_fee_nonneg" CHECK ("entryFee" >= 0);
ALTER TABLE "TournamentMatch" ADD CONSTRAINT "TournamentMatch_winner_is_player"
  CHECK ("winnerId" IS NULL OR "winnerId" = "entrantAId" OR "winnerId" = "entrantBId");
