// Tournaments: court reservations, entries, the knockout draw and results.
//
// Court time is reserved with reserveSessions (same locks + no-overlap
// constraint as bookings and classes). All bracket changes run in a transaction
// that locks the tournament row, so two people recording results at once can't
// corrupt the bracket.

import { Prisma, type PrismaClient } from '@prisma/client'
import { ConflictError, isExclusionViolation, ServiceError } from '@/lib/booking/errors'
import { todayIn, zonedToUtc } from '@/lib/booking/time'
import { assertSport, netPaid, reserveSessions, resolvePlayer, validateCourts } from '@/lib/club/service'
import { WEEKDAYS } from '@/lib/club/schedule'
import { generateBracket, nextSlot, roundsFor, shuffle } from './bracket'
import type { EntrantInput, Prize, ResultInput, ScheduleInput, TournamentInput } from './validation'

type Tx = Prisma.TransactionClient
const dec = (n: number) => new Prisma.Decimal(n.toFixed(2))
const r2 = (n: number) => Math.round(n * 100) / 100

const ALL_DAYS = [...WEEKDAYS]

function wrap(err: unknown): never {
  if (isExclusionViolation(err)) throw new ConflictError('A court was just booked at one of these times. Try again.')
  throw err
}

async function lockTournament(tx: Tx, venueId: string, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Tournament" WHERE id = ${id} AND "venueId" = ${venueId} FOR UPDATE`
  if (!rows.length) throw new ServiceError(404, 'NOT_FOUND', 'Tournament not found')
  return tx.tournament.findUniqueOrThrow({ where: { id } })
}

// ─── Create / update / cancel ───────────────────────────────────────────────

export async function createTournament(db: PrismaClient, venueId: string, actorId: string, input: TournamentInput & { skipConflicts: boolean }) {
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
  await validateCourts(db, venueId, input.courtIds)
  await assertSport(db, venueId, input.sportId)
  const today = todayIn(venue.timezone)
  if (input.endDate < today) throw new ServiceError(422, 'TOURNAMENT_IN_PAST', 'Those dates have already passed.')
  try {
    return await db.$transaction(async (tx) => {
      const t = await tx.tournament.create({
        data: {
          venueId, name: input.name, description: input.description ?? null, sportId: input.sportId ?? null, courtIds: input.courtIds,
          startDate: input.startDate, endDate: input.endDate, startMin: input.startMin, endMin: input.endMin,
          entryType: input.entryType ?? 'SINGLES', maxEntrants: input.maxEntrants ?? null, entryFee: dec(input.entryFee),
          prizes: (input.prizes ?? []) as unknown as Prisma.InputJsonValue, createdById: actorId,
        },
      })
      const r = await reserveSessions(tx, venueId, { tournamentId: t.id }, { ...t, days: ALL_DAYS }, `Tournament: ${t.name}`, venue.timezone, today, input.skipConflicts, actorId, { partial: true })
      return { id: t.id, ...r }
    }, { timeout: 20_000 })
  } catch (err) {
    wrap(err)
  }
}

export async function updateTournament(db: PrismaClient, venueId: string, actorId: string, id: string, input: Partial<TournamentInput> & { skipConflicts: boolean }) {
  const t = await db.tournament.findFirst({ where: { id, venueId } })
  if (!t) throw new ServiceError(404, 'NOT_FOUND', 'Tournament not found')
  if (t.status === 'CANCELLED') throw new ServiceError(422, 'CANCELLED', 'This tournament is cancelled.')
  const venue = await db.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })
  if (input.courtIds) await validateCourts(db, venueId, input.courtIds)
  if (input.sportId !== undefined) await assertSport(db, venueId, input.sportId)
  if (input.maxEntrants != null) {
    const count = await db.tournamentEntrant.count({ where: { tournamentId: id, withdrawn: false } })
    if (input.maxEntrants < count) throw new ServiceError(422, 'TOO_MANY_ENTRIES', `There are already ${count} entries.`)
  }
  const next = {
    ...t,
    ...Object.fromEntries(Object.entries(input).filter(([k, v]) => v !== undefined && k !== 'skipConflicts' && k !== 'entryFee' && k !== 'prizes')),
  } as typeof t
  if (next.endDate < next.startDate) throw new ServiceError(422, 'DATES', 'End date must be on or after the start date')
  const scheduleChanged = ['courtIds', 'startDate', 'endDate', 'startMin', 'endMin'].some((k) => (input as Record<string, unknown>)[k] !== undefined)
  if (scheduleChanged && t.status === 'COMPLETED') throw new ServiceError(422, 'COMPLETED', 'This tournament is finished.')

  try {
    return await db.$transaction(async (tx) => {
      await tx.tournament.update({
        where: { id },
        data: {
          name: next.name, description: next.description, sportId: next.sportId, courtIds: next.courtIds, startDate: next.startDate, endDate: next.endDate,
          startMin: next.startMin, endMin: next.endMin, entryType: next.entryType, maxEntrants: next.maxEntrants,
          ...(input.entryFee !== undefined && { entryFee: dec(input.entryFee) }),
          ...(input.prizes !== undefined && { prizes: input.prizes as unknown as Prisma.InputJsonValue }),
        },
      })
      if (scheduleChanged) {
        const r = await reserveSessions(tx, venueId, { tournamentId: id }, { ...next, days: ALL_DAYS }, `Tournament: ${next.name}`, venue.timezone, todayIn(venue.timezone), input.skipConflicts, actorId, { partial: true })
        return { id, ...r }
      }
      if (input.name) await tx.courtBlock.updateMany({ where: { tournamentId: id }, data: { reason: `Tournament: ${input.name}` } })
      return { id, sessions: null, skipped: 0, trimmed: 0 }
    }, { timeout: 20_000 })
  } catch (err) {
    wrap(err)
  }
}

/** Cancel: future court reservations are released. Entries, payments and results are kept. */
export async function cancelTournament(db: PrismaClient, venueId: string, id: string) {
  const t = await db.tournament.findFirst({ where: { id, venueId } })
  if (!t) throw new ServiceError(404, 'NOT_FOUND', 'Tournament not found')
  if (t.status === 'COMPLETED') throw new ServiceError(422, 'COMPLETED', 'A finished tournament cannot be cancelled.')
  const now = new Date()
  return db.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id }, data: { status: 'CANCELLED' } })
    const freed = await tx.courtBlock.deleteMany({ where: { tournamentId: id, startTime: { gte: now } } })
    return { freedSessions: freed.count }
  })
}

/** Release reservations after the tournament finishes early (remaining days become bookable). */
async function releaseRemainingCourtTime(tx: Tx, tournamentId: string) {
  await tx.courtBlock.deleteMany({ where: { tournamentId, startTime: { gte: new Date() } } })
}

// ─── Entries ────────────────────────────────────────────────────────────────

const nameKey = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-10)

/**
 * Refuse a second active entry for the same person: same linked player, same
 * name (case and spacing ignored) or same phone number. Withdrawn entries don't count.
 */
async function assertNotEntered(tx: Tx, tournamentId: string, who: { playerId?: string | null; name?: string | null; phone?: string | null }, excludeId?: string) {
  const others = await tx.tournamentEntrant.findMany({
    where: { tournamentId, withdrawn: false, ...(excludeId && { id: { not: excludeId } }) },
    select: { name: true, playerId: true, phone: true },
  })
  const name = who.name ? nameKey(who.name) : ''
  const phone = phoneKey(who.phone)
  const dup = others.find((o) =>
    (who.playerId && o.playerId === who.playerId) || (name && nameKey(o.name) === name) || (phone.length >= 7 && phoneKey(o.phone) === phone))
  if (!dup) return
  const why = who.playerId && dup.playerId === who.playerId ? 'This player' : name && nameKey(dup.name) === name ? `"${who.name!.trim()}"` : `Phone ${who.phone}`
  throw new ServiceError(409, 'ALREADY_ENTERED', `${why} is already entered in this tournament${why.startsWith('Phone') ? ` (as ${dup.name})` : ''}.`)
}

export async function addEntrant(db: PrismaClient, venueId: string, actorId: string, tournamentId: string, input: EntrantInput) {
  return db.$transaction(async (tx) => {
    const t = await lockTournament(tx, venueId, tournamentId)
    if (t.status !== 'REGISTRATION') throw new ServiceError(422, 'REGISTRATION_CLOSED', 'Registration is closed: the draw has been made.')
    const count = await tx.tournamentEntrant.count({ where: { tournamentId, withdrawn: false } })
    if (t.maxEntrants != null && count >= t.maxEntrants) throw new ServiceError(409, 'TOURNAMENT_FULL', `This tournament is full (${t.maxEntrants} entries).`)
    if (input.seed != null) {
      const taken = await tx.tournamentEntrant.findFirst({ where: { tournamentId, seed: input.seed, withdrawn: false } })
      if (taken) throw new ServiceError(409, 'SEED_TAKEN', `Seed ${input.seed} is already given to ${taken.name}.`)
    }
    if (input.payment && input.payment.amount > Number(t.entryFee)) throw new ServiceError(422, 'OVERPAYMENT', 'Payment cannot exceed the entry fee.')
    // Check before a new player record is created, so a refused entry leaves nothing behind.
    const existing = input.player && 'playerId' in input.player ? await tx.player.findFirst({ where: { id: input.player.playerId, venueId } }) : null
    const newP = input.player && 'newPlayer' in input.player ? input.player.newPlayer : null
    await assertNotEntered(tx, tournamentId, {
      playerId: existing?.id ?? null,
      name: input.name || existing?.name || newP?.name || null,
      phone: input.phone ?? existing?.phone ?? newP?.phone ?? null,
    })
    const player = input.player ? await resolvePlayer(tx, venueId, input.player) : null
    const entrant = await tx.tournamentEntrant.create({
      data: {
        tournamentId, venueId, name: input.name || player!.name, playerId: player?.id ?? null,
        phone: input.phone ?? player?.phone ?? null, seed: input.seed, createdById: actorId,
      },
    })
    if (input.payment) {
      await tx.payment.create({ data: { venueId, tournamentEntryId: entrant.id, method: input.payment.method, amount: dec(input.payment.amount), recordedById: actorId } })
    }
    return { id: entrant.id }
  })
}

export async function updateEntrant(db: PrismaClient, venueId: string, entrantId: string, input: { seed?: number | null; withdrawn?: boolean; name?: string }) {
  const e = await db.tournamentEntrant.findFirst({ where: { id: entrantId, venueId } })
  if (!e) throw new ServiceError(404, 'NOT_FOUND', 'Entry not found')
  return db.$transaction(async (tx) => {
    const t = await lockTournament(tx, venueId, e.tournamentId)
    if (t.status !== 'REGISTRATION') throw new ServiceError(422, 'REGISTRATION_CLOSED', 'Entries are locked once the draw is made.')
    if (input.seed != null) {
      const taken = await tx.tournamentEntrant.findFirst({ where: { tournamentId: t.id, seed: input.seed, withdrawn: false, NOT: { id: e.id } } })
      if (taken) throw new ServiceError(409, 'SEED_TAKEN', `Seed ${input.seed} is already given to ${taken.name}.`)
    }
    // Renaming, or bringing a withdrawn entry back, must not create a duplicate.
    if (input.name || (input.withdrawn === false && e.withdrawn)) {
      await assertNotEntered(tx, t.id, { playerId: e.playerId, name: input.name ?? e.name, phone: e.phone }, e.id)
    }
    return tx.tournamentEntrant.update({
      where: { id: e.id },
      data: {
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(input.withdrawn !== undefined && { withdrawn: input.withdrawn, ...(input.withdrawn && { seed: null }) }),
        ...(input.name && { name: input.name }),
      },
    })
  })
}

export async function payEntry(db: PrismaClient, venueId: string, actorId: string, entrantId: string, p: { amount: number; method: string; note: string | null }) {
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "TournamentEntrant" WHERE id = ${entrantId} AND "venueId" = ${venueId} FOR UPDATE`
    if (!rows.length) throw new ServiceError(404, 'NOT_FOUND', 'Entry not found')
    const e = await tx.tournamentEntrant.findUniqueOrThrow({ where: { id: entrantId }, include: { payments: true, tournament: { select: { entryFee: true } } } })
    const due = r2(Number(e.tournament.entryFee) - netPaid(e.payments))
    if (p.amount > due) throw new ServiceError(422, 'OVERPAYMENT', due > 0 ? `Only ${due.toFixed(2)} is outstanding.` : 'This entry is already paid.')
    await tx.payment.create({ data: { venueId, tournamentEntryId: entrantId, method: p.method as never, amount: dec(p.amount), note: p.note, recordedById: actorId } })
    return { balance: r2(due - p.amount) }
  })
}

// ─── Draw ───────────────────────────────────────────────────────────────────

/** Make (or redo) the knockout draw. Redrawing is only allowed before any real result is recorded. */
export async function drawBracket(db: PrismaClient, venueId: string, tournamentId: string, opts: { random: boolean }) {
  return db.$transaction(async (tx) => {
    const t = await lockTournament(tx, venueId, tournamentId)
    if (t.status === 'CANCELLED' || t.status === 'COMPLETED') throw new ServiceError(422, 'CLOSED', `This tournament is ${t.status.toLowerCase()}.`)
    const played = await tx.tournamentMatch.count({ where: { tournamentId, status: 'COMPLETED', OR: [{ score: null }, { score: { not: 'Bye' } }] } })
    if (played) throw new ServiceError(422, 'RESULTS_EXIST', 'Results have been recorded; the draw can no longer be redone.')
    const entrants = await tx.tournamentEntrant.findMany({ where: { tournamentId, withdrawn: false }, orderBy: { createdAt: 'asc' } })
    if (entrants.length < 2) throw new ServiceError(422, 'NOT_ENOUGH_ENTRIES', 'At least 2 entries are needed for a draw.')
    const seeded = entrants.filter((e) => e.seed != null)
    const unseeded = entrants.filter((e) => e.seed == null)
    const pool = [...seeded, ...(opts.random ? shuffle(unseeded) : unseeded)].map((e) => ({ id: e.id, seed: e.seed }))
    const matches = generateBracket(pool)
    await tx.tournamentMatch.deleteMany({ where: { tournamentId } })
    await tx.tournamentMatch.createMany({ data: matches.map((m) => ({ tournamentId, ...m })) })
    await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'IN_PROGRESS', winnerEntrantId: null } })
    return { matches: matches.length, rounds: roundsFor(pool.length) }
  })
}

/**
 * Undo the draw and take entries again. Only before any real result is recorded
 * (byes don't count); the bracket is discarded and is made again later.
 */
export async function reopenRegistration(db: PrismaClient, venueId: string, tournamentId: string) {
  return db.$transaction(async (tx) => {
    const t = await lockTournament(tx, venueId, tournamentId)
    if (t.status === 'REGISTRATION') return { status: t.status }
    if (t.status !== 'IN_PROGRESS') throw new ServiceError(422, 'CLOSED', `This tournament is ${t.status.toLowerCase()}.`)
    const played = await tx.tournamentMatch.count({ where: { tournamentId, status: 'COMPLETED', OR: [{ score: null }, { score: { not: 'Bye' } }] } })
    if (played) throw new ServiceError(422, 'RESULTS_EXIST', `${played} result${played === 1 ? ' has' : 's have'} been recorded, so registration can't be reopened. Undo ${played === 1 ? 'it' : 'them'} first.`)
    await tx.tournamentMatch.deleteMany({ where: { tournamentId } })
    await tx.tournament.update({ where: { id: tournamentId }, data: { status: 'REGISTRATION', winnerEntrantId: null } })
    return { status: 'REGISTRATION' as const }
  })
}

// ─── Results & scheduling ───────────────────────────────────────────────────

export async function updateMatch(db: PrismaClient, venueId: string, matchId: string, input: { result?: ResultInput; schedule?: ScheduleInput }) {
  const found = await db.tournamentMatch.findUnique({ where: { id: matchId }, select: { tournamentId: true } })
  if (!found) throw new ServiceError(404, 'NOT_FOUND', 'Match not found')
  return db.$transaction(async (tx) => {
    const t = await lockTournament(tx, venueId, found.tournamentId)
    if (t.status === 'CANCELLED') throw new ServiceError(422, 'CANCELLED', 'This tournament is cancelled.')
    const m = await tx.tournamentMatch.findUniqueOrThrow({ where: { id: matchId } })
    const venue = await tx.venue.findUniqueOrThrow({ where: { id: venueId }, select: { timezone: true } })

    if (input.schedule) {
      const s = input.schedule
      if (s.courtId && !t.courtIds.includes(s.courtId)) throw new ServiceError(422, 'COURT_NOT_IN_TOURNAMENT', 'Pick one of the tournament courts.')
      await tx.tournamentMatch.update({
        where: { id: m.id },
        data: { courtId: s.courtId, scheduledAt: s.date && s.start != null ? zonedToUtc(s.date, s.start, venue.timezone) : null },
      })
    }

    if (!input.result) return { id: m.id }
    const rounds = await tx.tournamentMatch.aggregate({ where: { tournamentId: t.id }, _max: { round: true } })
    const totalRounds = rounds._max.round ?? 1
    const isFinal = m.round === totalRounds
    const next = isFinal ? null : nextSlot(m.round, m.position)
    const nextMatch = next ? await tx.tournamentMatch.findUnique({ where: { tournamentId_round_position: { tournamentId: t.id, round: next.round, position: next.position } } }) : null
    if (m.score === 'Bye') throw new ServiceError(422, 'BYE', 'Byes advance automatically.')
    if (nextMatch?.status === 'COMPLETED') {
      throw new ServiceError(422, 'NEXT_PLAYED', 'The next round has been played. Undo that result first.')
    }
    const slotField = next?.slot === 'A' ? 'entrantAId' : 'entrantBId'

    if ('undo' in input.result) {
      if (m.status !== 'COMPLETED') return { id: m.id }
      await tx.tournamentMatch.update({ where: { id: m.id }, data: { status: 'PENDING', winnerId: null, score: null } })
      if (nextMatch) await tx.tournamentMatch.update({ where: { id: nextMatch.id }, data: { [slotField]: null } })
      if (isFinal) await tx.tournament.update({ where: { id: t.id }, data: { status: 'IN_PROGRESS', winnerEntrantId: null } })
      return { id: m.id }
    }

    const { winnerId, score, walkover } = input.result
    if (!m.entrantAId || !m.entrantBId) throw new ServiceError(422, 'WAITING', 'Both players must be known before recording a result.')
    if (winnerId !== m.entrantAId && winnerId !== m.entrantBId) throw new ServiceError(422, 'NOT_IN_MATCH', 'The winner must be one of the two players in this match.')
    await tx.tournamentMatch.update({
      where: { id: m.id },
      data: { status: 'COMPLETED', winnerId, score: walkover ? 'W/O' : score },
    })
    if (nextMatch) await tx.tournamentMatch.update({ where: { id: nextMatch.id }, data: { [slotField]: winnerId } })
    if (isFinal) {
      await tx.tournament.update({ where: { id: t.id }, data: { status: 'COMPLETED', winnerEntrantId: winnerId } })
      await releaseRemainingCourtTime(tx, t.id)
    }
    return { id: m.id, champion: isFinal ? winnerId : null }
  })
}

export function prizePool(prizes: unknown): number {
  return r2(((prizes as Prize[] | null) ?? []).reduce((s, p) => s + Number(p.amount || 0), 0))
}
