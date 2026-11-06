import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

export const DATE = '2030-01-10' // a Thursday
export const TZ = 'America/New_York'
const ALL_DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const

export async function assertTestDatabase() {
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`
  if (db !== 'gameon_test') throw new Error(`Integration tests must run against gameon_test, not ${db}`)
}

export async function resetDatabase() {
  await assertTestDatabase()
  await prisma.$executeRawUnsafe(`
    TRUNCATE "Payment", "CourtBlock", "Booking", "WalkInBooking", "PricingRule", "OperatingHours", "Court", "Sport",
             "VenueImage", "VenueAmenity", "VenueMember", "VenueRole", "Venue", "NotificationPrefs", "Session", "Account", "User" CASCADE`)
}

export async function seedVenue(label: string) {
  const owner = await prisma.user.create({ data: { email: `${label}-owner@test.local`, name: `${label} Owner`, role: 'VENUE_OWNER' } })
  const venue = await prisma.venue.create({
    data: { name: `${label} Arena`, slug: `${label}-arena`, ownerId: owner.id, timezone: TZ, currency: 'USD', isSetupDone: true },
  })
  const sport = await prisma.sport.create({ data: { venueId: venue.id, name: 'Pickleball', emoji: '🏓' } })
  const court1 = await prisma.court.create({ data: { venueId: venue.id, sportId: sport.id, name: 'Court 1' } })
  const court2 = await prisma.court.create({ data: { venueId: venue.id, sportId: sport.id, name: 'Court 2' } })
  await prisma.operatingHours.createMany({
    data: ALL_DAYS.map((day) => ({ venueId: venue.id, sportId: sport.id, day, openTime: '6:00 AM', closeTime: '11:00 PM' })),
  })
  const days = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
  await prisma.pricingRule.createMany({
    data: [
      { venueId: venue.id, sportId: sport.id, label: 'Off-peak', days, startTime: '6:00 AM', endTime: '5:00 PM', priceUsd: 20 },
      { venueId: venue.id, sportId: sport.id, label: 'Peak', days, startTime: '5:00 PM', endTime: '11:00 PM', priceUsd: 30 },
    ],
  })
  return { owner, venue, sport, court1, court2 }
}

export async function addStaff(venueId: string, label: string, permissions: Record<string, string>) {
  const user = await prisma.user.create({ data: { email: `${label}@test.local`, name: label, role: 'STAFF' } })
  const role = await prisma.venueRole.create({ data: { venueId, name: label, permissions } })
  await prisma.venueMember.create({ data: { venueId, userId: user.id, roleId: role.id, email: user.email, name: label, status: 'active' } })
  return user
}

export function bookingInput(courtId: string, o: Partial<Record<string, unknown>> = {}) {
  return {
    venueId: null,
    courtId,
    sportId: null,
    customer: 'Test Customer',
    phone: '+1 555 0100',
    email: null,
    source: 'PHONE' as const,
    date: DATE,
    startMin: 10 * 60,
    endMin: 11 * 60,
    amount: null,
    status: 'CONFIRMED' as const,
    notes: null,
    overrideHours: false,
    initialPayment: null,
    ...o,
  }
}
