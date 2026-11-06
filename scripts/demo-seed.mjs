// Adds (or resets) a demo venue in your LOCAL development database (.env.local)
// for manual testing and demos with `pnpm dev`.
//
// Safe to re-run: it only deletes and recreates the demo accounts and the demo
// venue below. Your other venues, users and bookings are left untouched.
// Refuses to run against a non-local database (e.g. Neon production).
//
// Demo logins (test-only credentials, local database only):
//   owner:  demo-owner@gameon.test / DemoOwner!2026
//   staff:  demo-staff@gameon.test / DemoStaff!2026   (bookings: view only)
//
// Usage: pnpm demo:seed

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const line = fs.readFileSync(path.join(root, '.env.local'), 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='))
const u = new URL(line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, ''))
if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) throw new Error('Refusing: DATABASE_URL in .env.local is not a local database')
const prisma = new PrismaClient({ datasourceUrl: u.toString() })

const TZ = 'America/Phoenix'
const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
const ALL = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'

function localDate(offsetDays) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const [y, m, d] = p.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
}
// Phoenix is UTC-7 all year (no DST)
const at = (date, min) => new Date(Date.parse(`${date}T00:00:00Z`) + (min + 7 * 60) * 60000)

async function main() {
  const [{ db }] = await prisma.$queryRaw`SELECT current_database() AS db`
  if (db === 'gameon_test') throw new Error('Refusing: gameon_test is reserved for automated tests (it is wiped on every run)')

  // Remove only the previous demo data (if any).
  const DEMO_EMAILS = ['demo-owner@gameon.test', 'demo-staff@gameon.test']
  const oldUsers = await prisma.user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { id: true } })
  const oldVenues = await prisma.venue.findMany({ where: { OR: [{ ownerId: { in: oldUsers.map((x) => x.id) } }, { slug: 'demo-sports-club' }] }, select: { id: true } })
  const venueIds = oldVenues.map((v) => v.id)
  if (venueIds.length) {
    await prisma.payment.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.booking.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.walkInBooking.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.pricingRule.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.venue.deleteMany({ where: { id: { in: venueIds } } }) // cascades courts, sports, hours, blocks, roles, members, images
  }
  await prisma.user.deleteMany({ where: { email: { in: DEMO_EMAILS } } })

  const owner = await prisma.user.create({
    data: { email: 'demo-owner@gameon.test', name: 'Demo Owner', role: 'VENUE_OWNER', emailVerified: new Date(), password: await bcrypt.hash('DemoOwner!2026', 10) },
  })
  const venue = await prisma.venue.create({
    data: { name: 'Demo Sports Club', slug: 'demo-sports-club', ownerId: owner.id, city: 'Chandler', country: 'United States', timezone: TZ, currency: 'USD', isSetupDone: true, onboardingStep: 'DONE' },
  })
  const pickle = await prisma.sport.create({ data: { venueId: venue.id, name: 'Pickleball', emoji: '🏓' } })
  const badminton = await prisma.sport.create({ data: { venueId: venue.id, name: 'Badminton', emoji: '🏸' } })
  const courts = []
  for (const [sport, names] of [[pickle, ['Pickle 1', 'Pickle 2']], [badminton, ['Shuttle A']]]) {
    for (const name of names) courts.push(await prisma.court.create({ data: { venueId: venue.id, sportId: sport.id, name } }))
  }
  for (const s of [pickle, badminton]) {
    await prisma.operatingHours.createMany({ data: DAYS.map((day) => ({ venueId: venue.id, sportId: s.id, day, openTime: '7:00 AM', closeTime: '10:00 PM' })) })
    await prisma.pricingRule.createMany({
      data: [
        { venueId: venue.id, sportId: s.id, label: 'Off-peak', days: ALL, startTime: '7:00 AM', endTime: '5:00 PM', priceUsd: s === pickle ? 20 : 15 },
        { venueId: venue.id, sportId: s.id, label: 'Peak', days: ALL, startTime: '5:00 PM', endTime: '10:00 PM', priceUsd: s === pickle ? 30 : 22 },
      ],
    })
  }
  const staff = await prisma.user.create({
    data: { email: 'demo-staff@gameon.test', name: 'Demo Staff', role: 'STAFF', emailVerified: new Date(), password: await bcrypt.hash('DemoStaff!2026', 10) },
  })
  const role = await prisma.venueRole.create({ data: { venueId: venue.id, name: 'Front desk (view)', permissions: { bookings: 'view', venue: 'none', reports: 'none', billing: 'none', team: 'none' } } })
  await prisma.venueMember.create({ data: { venueId: venue.id, userId: staff.id, roleId: role.id, email: staff.email, name: staff.name, status: 'active' } })

  // A handful of bookings around today, non-overlapping per court.
  const plan = [
    [-2, 0, 9 * 60, 60, 'Maya Lopez', 'PHONE', 'COMPLETED', 'CASH'],
    [-2, 2, 18 * 60, 90, 'Ken Ito', 'PLAYO', 'COMPLETED', 'ONLINE'],
    [-1, 1, 17 * 60, 60, 'Ravi Shah', 'WHATSAPP', 'COMPLETED', 'UPI'],
    [-1, 0, 10 * 60, 60, 'Lena Park', 'GAMEON', 'CANCELLED', null],
    [0, 0, 8 * 60, 60, 'Sam Carter', 'WALK_IN', 'CHECKED_IN', 'CASH'],
    [0, 0, 18 * 60, 120, 'Ana Gomez', 'PHONE', 'CONFIRMED', null],
    [0, 1, 19 * 60, 60, 'Dev Patel', 'DISTRICT', 'CONFIRMED', 'ONLINE'],
    [0, 2, 12 * 60, 60, 'Jo Kim', 'PHONE', 'PENDING', null],
    [1, 1, 9 * 60, 90, 'Tom Reed', 'GAMEON', 'CONFIRMED', null],
    [2, 2, 17 * 60, 60, 'Nia Brooks', 'WALK_IN', 'CONFIRMED', null],
  ]
  for (const [off, ci, start, dur, customer, source, status, method] of plan) {
    const court = courts[ci]
    const sport = court.sportId === pickle.id ? pickle : badminton
    const date = localDate(off)
    const [offRate, peakRate] = sport === pickle ? [20, 30] : [15, 22]
    let amount = 0
    for (let m = start; m < start + dur; m++) amount += (m >= 17 * 60 ? peakRate : offRate) / 60
    amount = Math.round(amount * 100) / 100
    const b = await prisma.booking.create({
      data: {
        venueId: venue.id, courtId: court.id, sportId: sport.id, sport: sport.name, customer, phone: '+1 480 555 01' + String(10 + ci), source,
        startTime: at(date, start), endTime: at(date, start + dur), amountUsd: amount, status,
        payment: method ? 'PAID' : 'PENDING', createdById: owner.id,
        ...(status === 'CANCELLED' && { cancelledAt: new Date(), cancelReason: 'Customer called off' }),
      },
    })
    if (method) await prisma.payment.create({ data: { bookingId: b.id, venueId: venue.id, kind: 'PAYMENT', method, amount, recordedById: owner.id, receivedAt: at(date, start) } })
  }
  await prisma.courtBlock.create({ data: { venueId: venue.id, courtId: courts[1].id, startTime: at(localDate(0), 14 * 60), endTime: at(localDate(0), 16 * 60), reason: 'Net repair', createdById: owner.id } })
  console.log(`Demo venue ready in local database "${db}" (${plan.length} bookings, today = ${localDate(0)} ${TZ})`)
}

main().finally(() => prisma.$disconnect())
