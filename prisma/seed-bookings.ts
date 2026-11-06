import { PrismaClient, BookingStatus, PaymentStatus } from '@prisma/client'

const prisma = new PrismaClient()

const FIRST_NAMES = ['James', 'Sophia', 'Liam', 'Emma', 'Noah', 'Olivia', 'Ethan', 'Ava', 'Mason', 'Isabella',
  'Lucas', 'Mia', 'Aiden', 'Harper', 'Jackson', 'Ella', 'Sebastian', 'Scarlett', 'Mateo', 'Grace',
  'Logan', 'Chloe', 'Owen', 'Zoey', 'Ryan', 'Nora', 'Daniel', 'Lily', 'Jack', 'Riley']

const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Wilson', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Thompson',
  'Young', 'Allen', 'King', 'Wright', 'Lopez', 'Hill', 'Scott', 'Green', 'Adams', 'Baker', 'Nelson']

const SPORTS = ['Pickleball', 'Tennis', 'Badminton', 'Squash']

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randPhone() {
  return `(${randInt(200, 999)}) ${randInt(200, 999)}-${randInt(1000, 9999)}`
}

function randName() {
  return `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`
}

// Weighted status: mostly completed/confirmed, some cancelled
function randStatus(date: Date): BookingStatus {
  const isPast = date < new Date()
  if (isPast) {
    const r = Math.random()
    if (r < 0.65) return BookingStatus.COMPLETED
    if (r < 0.80) return BookingStatus.CHECKED_IN
    if (r < 0.93) return BookingStatus.CONFIRMED
    return BookingStatus.CANCELLED
  }
  return Math.random() < 0.85 ? BookingStatus.CONFIRMED : BookingStatus.CANCELLED
}

function randPayment(status: BookingStatus): PaymentStatus {
  if (status === BookingStatus.CANCELLED) return Math.random() < 0.4 ? PaymentStatus.REFUNDED : PaymentStatus.PENDING
  if (status === BookingStatus.COMPLETED || status === BookingStatus.CHECKED_IN) {
    return Math.random() < 0.9 ? PaymentStatus.PAID : PaymentStatus.PENDING
  }
  return Math.random() < 0.5 ? PaymentStatus.PAID : PaymentStatus.PENDING
}

// Slot durations: 1h or 1.5h
const SLOT_HOURS = [1, 1, 1, 1.5, 1.5, 2]

// Operating hours: 7am–10pm
const OPEN_HOUR = 7
const CLOSE_HOUR = 22

// Price per hour
const PRICE_PER_HOUR: Record<string, number> = {
  Pickleball: 25, Tennis: 30, Badminton: 20, Squash: 22,
}

async function main() {
  const venues = await prisma.venue.findMany({ include: { courts: true } })
  if (venues.length === 0) {
    console.error('No venues found. Set up your venue first.')
    process.exit(1)
  }

  const venue = venues[0]
  const courts = venue.courts
  console.log(`Seeding bookings for "${venue.name}" (${courts.length} courts)`)

  // 2 months back + 2 weeks forward
  const now = new Date()
  const startDate = new Date(now)
  startDate.setDate(startDate.getDate() - 60)
  startDate.setHours(0, 0, 0, 0)

  const endDate = new Date(now)
  endDate.setDate(endDate.getDate() + 14)

  const bookings: Parameters<typeof prisma.booking.create>[0]['data'][] = []

  // Iterate each day
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    const dayOfWeek = cursor.getDay() // 0=Sun

    // Occupancy varies by day: weekends busier
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
    const slotsPerCourt = isWeekend ? randInt(6, 11) : randInt(3, 7)

    for (const court of courts) {
      const usedSlots: Array<[number, number]> = [] // [startMin, endMin] from midnight

      for (let s = 0; s < slotsPerCourt; s++) {
        const durationHrs = rand(SLOT_HOURS)
        const durationMins = durationHrs * 60

        // Try to find a free slot
        let attempts = 0
        let placed = false
        while (attempts < 20 && !placed) {
          attempts++
          // Random start hour between OPEN_HOUR and CLOSE_HOUR - duration
          const latestStart = CLOSE_HOUR - durationHrs
          if (latestStart <= OPEN_HOUR) break
          const startHour = randInt(OPEN_HOUR, Math.floor(latestStart))
          const startMin = rand([0, 30])
          const startMins = startHour * 60 + startMin
          const endMins = startMins + durationMins

          // Check no overlap
          const overlaps = usedSlots.some(([a, b]) => startMins < b && endMins > a)
          if (!overlaps && endMins <= CLOSE_HOUR * 60) {
            usedSlots.push([startMins, endMins])
            placed = true

            const startTime = new Date(cursor)
            startTime.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0)
            const endTime = new Date(cursor)
            endTime.setHours(Math.floor(endMins / 60), endMins % 60, 0, 0)

            const sport = rand(SPORTS)
            const status = randStatus(startTime)
            const payment = randPayment(status)
            const amount = (PRICE_PER_HOUR[sport] * durationHrs).toFixed(2)

            bookings.push({
              venueId: venue.id,
              courtId: court.id,
              customer: randName(),
              phone: randPhone(),
              sport,
              startTime,
              endTime,
              amountUsd: amount,
              status,
              payment,
              notes: Math.random() < 0.15 ? rand(['Bring extra balls', 'First time player', 'Regular customer', 'Paid in cash']) : null,
            })
          }
        }
      }
    }

    cursor.setDate(cursor.getDate() + 1)
  }

  // Batch insert
  await prisma.booking.createMany({ data: bookings as never })
  console.log(`✓ Inserted ${bookings.length} bookings across ${Math.round((endDate.getTime() - startDate.getTime()) / 86400000)} days`)
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => { console.error(e); prisma.$disconnect(); process.exit(1) })
