// Shared by the booking engine and the club service (kept separate to avoid an import cycle).

import type { Prisma, PrismaClient } from '@prisma/client'
import { ServiceError } from '@/lib/booking/errors'

type Tx = Prisma.TransactionClient

/**
 * The membership that covers a booking: must belong to the venue, be active on
 * the booking date, and (if the plan is sport-specific) match the sport.
 */
export async function membershipForBooking(db: PrismaClient | Tx, venueId: string, membershipId: string, date: string, sportId: string | null) {
  const m = await db.membership.findFirst({ where: { id: membershipId, venueId }, include: { plan: true, player: true } })
  if (!m) throw new ServiceError(404, 'MEMBERSHIP_NOT_FOUND', 'Membership not found')
  if (m.status !== 'ACTIVE') throw new ServiceError(422, 'MEMBERSHIP_CANCELLED', `${m.player.name}'s membership is cancelled.`)
  if (date < m.startDate || date > m.endDate) {
    throw new ServiceError(422, 'MEMBERSHIP_NOT_VALID', `${m.player.name}'s membership is valid ${m.startDate} to ${m.endDate}, not on ${date}.`)
  }
  if (m.plan.sportId && m.plan.sportId !== sportId) {
    throw new ServiceError(422, 'MEMBERSHIP_WRONG_SPORT', `${m.plan.name} doesn't cover this sport.`)
  }
  return m
}
