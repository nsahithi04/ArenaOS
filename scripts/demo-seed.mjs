// Adds (or resets) a demo venue in your LOCAL development database (.env.local)
// for manual testing and demos with `pnpm dev`.
//
// Safe to re-run: it only deletes and recreates the demo accounts and the demo
// venue below. Your other venues, users and bookings are left untouched.
// Refuses to run against a non-local database (e.g. Neon production).
//
// Demo logins (test-only credentials, local database only):
//   owner:    demo-owner@gameon.test   / DemoOwner!2026     (full access)
//   manager:  demo-manager@gameon.test / DemoManager!2026   (Manager role)
//   employee: demo-staff@gameon.test   / DemoStaff!2026     (Employee role)
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
  const DEMO_EMAILS = ['demo-owner@gameon.test', 'demo-manager@gameon.test', 'demo-staff@gameon.test']
  const oldUsers = await prisma.user.findMany({ where: { email: { in: DEMO_EMAILS } }, select: { id: true } })
  const oldVenues = await prisma.venue.findMany({ where: { OR: [{ ownerId: { in: oldUsers.map((x) => x.id) } }, { slug: 'demo-sports-club' }] }, select: { id: true } })
  const venueIds = oldVenues.map((v) => v.id)
  if (venueIds.length) {
    await prisma.payment.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.booking.deleteMany({ where: { venueId: { in: venueIds } } })
    await prisma.membership.deleteMany({ where: { venueId: { in: venueIds } } })
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
  // Built-in roles (must match lib/team/presets.ts)
  const managerRole = await prisma.venueRole.create({ data: { venueId: venue.id, preset: 'MANAGER', name: 'Manager', color: '#7c3aed', permissions: { bookings: 'edit', venue: 'edit', reports: 'view', billing: 'edit', team: 'edit' } } })
  const employeeRole = await prisma.venueRole.create({ data: { venueId: venue.id, preset: 'EMPLOYEE', name: 'Employee', color: '#2563eb', permissions: { bookings: 'edit', venue: 'none', reports: 'none', billing: 'none', team: 'none' } } })
  for (const [email, name, pw, role] of [
    ['demo-manager@gameon.test', 'Demo Manager', 'DemoManager!2026', managerRole],
    ['demo-staff@gameon.test', 'Demo Employee', 'DemoStaff!2026', employeeRole],
  ]) {
    const user = await prisma.user.create({ data: { email, name, role: 'STAFF', emailVerified: new Date(), password: await bcrypt.hash(pw, 10) } })
    await prisma.venueMember.create({ data: { venueId: venue.id, userId: user.id, roleId: role.id, email, name, status: 'active' } })
  }

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
  // ── Memberships ─────────────────────────────────────────────────────────
  const monthly = await prisma.membershipPlan.create({ data: { venueId: venue.id, name: 'Monthly Unlimited', durationMonths: 1, price: 99, description: 'Play any sport, any time the courts are free' } })
  const annual = await prisma.membershipPlan.create({ data: { venueId: venue.id, name: 'Annual Unlimited', durationMonths: 12, price: 999 } })
  await prisma.membershipPlan.create({ data: { venueId: venue.id, name: 'Pickleball Monthly', durationMonths: 1, price: 69, sportId: pickle.id } })
  const endOf = (start, months) => {
    const [y, m, d] = start.split('-').map(Number)
    const t = new Date(Date.UTC(y, m - 1 + months, d))
    if (t.getUTCDate() !== d) return new Date(Date.UTC(y, m - 1 + months + 1, 0)).toISOString().slice(0, 10)
    return new Date(Date.UTC(y, m - 1 + months, d - 1)).toISOString().slice(0, 10)
  }
  const members = [
    ['Priya Nair', '+1 480 555 0201', monthly, localDate(-10), 99],
    ['Marcus Bell', '+1 480 555 0202', annual, localDate(-40), 999],
    ['Hana Sato', '+1 480 555 0203', monthly, localDate(-2), 50], // still owes 49
  ]
  const memberships = []
  for (const [name, phone, plan, start, paid] of members) {
    const player = await prisma.player.create({ data: { venueId: venue.id, name, phone } })
    const ms = await prisma.membership.create({
      data: { venueId: venue.id, playerId: player.id, planId: plan.id, startDate: start, endDate: endOf(start, plan.durationMonths), price: plan.price, createdById: owner.id },
    })
    await prisma.payment.create({ data: { venueId: venue.id, membershipId: ms.id, method: 'UPI', amount: paid, receivedAt: at(start, 10 * 60), recordedById: owner.id } })
    memberships.push({ ms, player })
  }
  // A member booking tomorrow morning, covered by Priya's membership
  await prisma.booking.create({
    data: {
      venueId: venue.id, courtId: courts[0].id, sportId: pickle.id, sport: 'Pickleball', customer: 'Priya Nair', phone: '+1 480 555 0201',
      source: 'PHONE', startTime: at(localDate(1), 7 * 60), endTime: at(localDate(1), 8 * 60), amountUsd: 0, payment: 'PAID', status: 'CONFIRMED',
      createdById: owner.id, playerId: memberships[0].player.id, membershipId: memberships[0].ms.id,
    },
  })

  // ── A coaching class: Mon & Wed 4–5:30 PM on Pickle 2 for 8 weeks ───────
  const cls = await prisma.class.create({
    data: {
      venueId: venue.id, name: 'Junior Pickleball', coachName: 'Maria Rivera', sportId: pickle.id, courtIds: [courts[1].id],
      days: ['MONDAY', 'WEDNESDAY'], startMin: 16 * 60, endMin: 17 * 60 + 30, startDate: localDate(0), endDate: localDate(55),
      capacity: 8, fee: 120, feePeriod: 'MONTH', createdById: owner.id,
    },
  })
  let sessions = 0
  for (let i = 0; i <= 55; i++) {
    const d = localDate(i)
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay() // 1 = Mon, 3 = Wed
    if (dow !== 1 && dow !== 3) continue
    const start = at(d, 16 * 60), end = at(d, 17 * 60 + 30)
    const clash = await prisma.booking.count({ where: { courtId: courts[1].id, status: { not: 'CANCELLED' }, startTime: { lt: end }, endTime: { gt: start } } })
      + await prisma.courtBlock.count({ where: { courtId: courts[1].id, startTime: { lt: end }, endTime: { gt: start } } })
    if (clash) continue
    await prisma.courtBlock.create({ data: { venueId: venue.id, courtId: courts[1].id, startTime: start, endTime: end, classId: cls.id, reason: 'Class: Junior Pickleball', createdById: owner.id } })
    sessions++
  }
  for (const [name, paid] of [['Leo Park', 120], ['Ava Singh', 120], ['Noah Kim', 0]]) {
    const player = await prisma.player.create({ data: { venueId: venue.id, name } })
    const e = await prisma.enrollment.create({ data: { venueId: venue.id, classId: cls.id, playerId: player.id, createdById: owner.id } })
    if (paid) await prisma.payment.create({ data: { venueId: venue.id, enrollmentId: e.id, method: 'CASH', amount: paid, recordedById: owner.id } })
  }

  console.log(`Demo venue ready in local database "${db}" (${plan.length} bookings, ${members.length} members, 1 class with ${sessions} sessions, today = ${localDate(0)} ${TZ})`)
}

main().finally(() => prisma.$disconnect())
