-- CreateEnum
CREATE TYPE "VenueRolePreset" AS ENUM ('MANAGER', 'EMPLOYEE');

-- AlterTable
ALTER TABLE "VenueRole" ADD COLUMN     "preset" "VenueRolePreset";

-- CreateIndex
CREATE UNIQUE INDEX "VenueRole_venueId_preset_key" ON "VenueRole"("venueId", "preset");

