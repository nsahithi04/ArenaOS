// Payments ledger, outstanding balances and membership renewals.

import type { Prisma, PrismaClient } from '@prisma/client'
import { addDays, diffDays, isLocalDate, localDateOf, localMinutesOf, localRangeToUtc } from '@/lib/booking/time'
import { netPaid } from '@/lib/club/service'

export const PAYMENT_TYPES = ['BOOKING', 'MEMBERSHIP', 'CLASS', 'TOURNAMENT'] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]
const r2 = (n: number) => Math.round(n * 100) / 100

// ─── Ledger ─────────────────────────────────────────────────────────────────

export type LedgerFilters = {
  from?: string; to?: string; types?: PaymentType[]; methods?: string[]; kind?: 'PAYMENT' | 'REFUND'; q?: string
  sort: 'date' | 'amount'; order: 'asc' | 'desc'
}

export function ledgerWhere(venueId: string, tz: string, f: LedgerFilters): Prisma.PaymentWhereInput {
  const and: Prisma.PaymentWhereInput[] = [{ venueId }]
  if (f.from || f.to) {
    const { start, end } = localRangeToUtc(f.from ?? '2000-01-01', f.to ?? addDays(f.from!, 3650), tz)
    and.push({ receivedAt: { gte: start, lt: end } })
  }
  if (f.types?.length && f.types.length < PAYMENT_TYPES.length) {
    and.push({
      OR: f.types.map((t) =>
        t === 'BOOKING' ? { bookingId: { not: null } }
        : t === 'MEMBERSHIP' ? { membershipId: { not: null } }
        : t === 'CLASS' ? { enrollmentId: { not: null } }
        : { tournamentEntryId: { not: null } }),
    })
  }
  if (f.methods?.length) and.push({ method: { in: f.methods as never } })
  if (f.kind) and.push({ kind: f.kind })
  if (f.q) {
    const c = { contains: f.q, mode: 'insensitive' as const }
    and.push({
      OR: [
        { booking: { customer: c } },
        { membership: { player: { name: c } } },
        { enrollment: { player: { name: c } } },
        { tournamentEntry: { name: c } },
        { note: c },
      ],
    })
  }
  return { AND: and }
}

export const ledgerSelect = {
  id: true, kind: true, method: true, amount: true, receivedAt: true, note: true, bookingId: true, membershipId: true, enrollmentId: true, tournamentEntryId: true,
  recordedBy: { select: { name: true } },
  booking: { select: { customer: true, startTime: true, court: { select: { name: true } } } },
  membership: { select: { player: { select: { name: true } }, plan: { select: { name: true } } } },
  enrollment: { select: { player: { select: { name: true } }, class: { select: { name: true } } } },
  tournamentEntry: { select: { name: true, tournament: { select: { id: true, name: true } } } },
} satisfies Prisma.PaymentSelect

type LedgerRow = Prisma.PaymentGetPayload<{ select: typeof ledgerSelect }>

export function toLedgerDTO(p: LedgerRow, tz: string) {
  const type: PaymentType = p.bookingId ? 'BOOKING' : p.membershipId ? 'MEMBERSHIP' : p.enrollmentId ? 'CLASS' : 'TOURNAMENT'
  const payer = p.booking?.customer ?? p.membership?.player.name ?? p.enrollment?.player.name ?? p.tournamentEntry?.name ?? '—'
  const detail =
    type === 'BOOKING' ? `${p.booking!.court.name} · ${localDateOf(p.booking!.startTime, tz)}`
    : type === 'MEMBERSHIP' ? p.membership!.plan.name
    : type === 'CLASS' ? p.enrollment!.class.name
    : p.tournamentEntry!.tournament.name
  return {
    id: p.id, kind: p.kind, method: p.method, amount: Number(p.amount), signedAmount: Number(p.amount) * (p.kind === 'REFUND' ? -1 : 1),
    date: localDateOf(p.receivedAt, tz), minutes: localMinutesOf(p.receivedAt, tz), receivedAt: p.receivedAt.toISOString(),
    type, payer, detail, note: p.note, recordedBy: p.recordedBy?.name ?? null,
    bookingId: p.bookingId, tournamentId: p.tournamentEntry?.tournament.id ?? null,
  }
}

export async function ledgerTotals(db: PrismaClient, where: Prisma.PaymentWhereInput) {
  const sums = await db.payment.groupBy({ by: ['kind'], where, _sum: { amount: true }, _count: { _all: true } })
  const received = Number(sums.find((s) => s.kind === 'PAYMENT')?._sum.amount ?? 0)
  const refunded = Number(sums.find((s) => s.kind === 'REFUND')?._sum.amount ?? 0)
  return { received: r2(received), refunded: r2(refunded), net: r2(received - refunded), count: sums.reduce((s, x) => s + x._count._all, 0) }
}

// ─── Outstanding balances ───────────────────────────────────────────────────

export type PendingItem = {
  type: PaymentType
  /** Id used to record a payment: booking / membership / enrollment / tournament entry */
  targetId: string
  tournamentId: string | null
  payer: string
  phone: string | null
  detail: string
  date: string // when it's for (booking date, membership start, enrolment, tournament start)
  total: number
  paid: number
  due: number
  note: string | null
}

/** Whole months from `from` to `to` inclusive of both months (2026-01-31 → 2026-02-01 = 2). */
export function monthsInclusive(from: string, to: string): number {
  const [y1, m1] = from.split('-').map(Number)
  const [y2, m2] = to.split('-').map(Number)
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) + 1)
}

/**
 * Everything still owed. Cancelled bookings/memberships/classes/tournaments and
 * withdrawn entries/students are excluded. Monthly class fees are due for each
 * month (or part month) from enrolment up to this month, within the class term.
 */
export async function pendingBalances(db: PrismaClient, venueId: string, tz: string, today: string, opts: { contact: boolean }): Promise<PendingItem[]> {
  const [bookings, memberships, enrollments, entrants] = await Promise.all([
    db.booking.findMany({
      where: { venueId, status: { not: 'CANCELLED' }, payment: { not: 'PAID' }, membershipId: null, amountUsd: { gt: 0 } },
      select: { id: true, customer: true, phone: true, startTime: true, amountUsd: true, court: { select: { name: true } }, payments: { select: { kind: true, amount: true } } },
      orderBy: { startTime: 'asc' },
      take: 2000,
    }),
    db.membership.findMany({
      where: { venueId, status: 'ACTIVE', price: { gt: 0 } },
      include: { player: true, plan: { select: { name: true } }, payments: { select: { kind: true, amount: true } } },
    }),
    db.enrollment.findMany({
      where: { venueId, status: 'ACTIVE', class: { status: 'ACTIVE', fee: { gt: 0 } } },
      include: { player: true, class: true, payments: { select: { kind: true, amount: true } } },
    }),
    db.tournamentEntrant.findMany({
      where: { venueId, withdrawn: false, tournament: { status: { not: 'CANCELLED' }, entryFee: { gt: 0 } } },
      include: { tournament: { select: { id: true, name: true, entryFee: true, startDate: true } }, payments: { select: { kind: true, amount: true } } },
    }),
  ])
  const out: PendingItem[] = []
  const push = (x: PendingItem) => { if (x.due > 0.004) out.push({ ...x, total: r2(x.total), paid: r2(x.paid), due: r2(x.due), phone: opts.contact ? x.phone : null }) }

  for (const b of bookings) {
    const paid = netPaid(b.payments)
    const total = Number(b.amountUsd)
    push({ type: 'BOOKING', targetId: b.id, tournamentId: null, payer: b.customer, phone: b.phone, detail: `Court booking · ${b.court.name}`, date: localDateOf(b.startTime, tz), total, paid, due: total - paid, note: null })
  }
  for (const m of memberships) {
    const paid = netPaid(m.payments)
    const total = Number(m.price)
    push({ type: 'MEMBERSHIP', targetId: m.id, tournamentId: null, payer: m.player.name, phone: m.player.phone, detail: `Membership · ${m.plan.name}`, date: m.startDate, total, paid, due: total - paid, note: null })
  }
  for (const e of enrollments) {
    const c = e.class
    const paid = netPaid(e.payments)
    const fee = Number(c.fee)
    let total = fee
    let note: string | null = null
    if (c.feePeriod === 'MONTH') {
      const enrolled = localDateOf(e.createdAt, tz)
      const from = enrolled > c.startDate ? enrolled : c.startDate
      const to = today < c.endDate ? today : c.endDate
      const months = from > to ? 0 : monthsInclusive(from, to)
      total = fee * months
      note = `${months} month${months === 1 ? '' : 's'} so far`
    }
    push({ type: 'CLASS', targetId: e.id, tournamentId: null, payer: e.player.name, phone: e.player.phone, detail: `Class · ${c.name}`, date: c.startDate, total, paid, due: total - paid, note })
  }
  for (const e of entrants) {
    const paid = netPaid(e.payments)
    const total = Number(e.tournament.entryFee)
    push({ type: 'TOURNAMENT', targetId: e.id, tournamentId: e.tournament.id, payer: e.name, phone: e.phone, detail: `Tournament · ${e.tournament.name}`, date: e.tournament.startDate, total, paid, due: total - paid, note: null })
  }
  return out
}

// ─── Renewals ───────────────────────────────────────────────────────────────

export type RenewalItem = {
  membershipId: string; playerId: string; playerName: string; email: string | null; phone: string | null
  planId: string; planName: string; planActive: boolean; price: number; startDate: string; endDate: string
  /** Positive = days left, 0 = ends today, negative = days since it ended */
  daysLeft: number
  state: 'EXPIRING' | 'EXPIRED'
  remindedAt: string | null
}

/**
 * Memberships that need renewing: active ones ending within `withinDays`, and
 * ones that ended in the last `expiredDays` days — skipping members who already
 * have a membership running past this one (i.e. already renewed).
 */
export async function renewalsDue(db: PrismaClient, venueId: string, today: string, opts: { withinDays: number; expiredDays: number; contact: boolean }): Promise<RenewalItem[]> {
  const lower = addDays(today, -opts.expiredDays)
  const upper = addDays(today, opts.withinDays)
  const candidates = await db.membership.findMany({
    where: { venueId, status: 'ACTIVE', endDate: { gte: lower, lte: upper } },
    include: { player: true, plan: { select: { id: true, name: true, isActive: true, price: true } } },
    orderBy: { endDate: 'asc' },
  })
  if (!candidates.length) return []
  // Renewed already = the player holds another active membership that ends later.
  const later = await db.membership.findMany({
    where: { venueId, status: 'ACTIVE', playerId: { in: [...new Set(candidates.map((c) => c.playerId))] } },
    select: { id: true, playerId: true, endDate: true },
  })
  return candidates
    .filter((m) => !later.some((o) => o.playerId === m.playerId && o.id !== m.id && o.endDate > m.endDate))
    .map((m) => {
      const daysLeft = diffDays(today, m.endDate)
      return {
        membershipId: m.id, playerId: m.playerId, playerName: m.player.name,
        email: opts.contact ? m.player.email : m.player.email ? '•••' : null,
        phone: opts.contact ? m.player.phone : null,
        planId: m.plan.id, planName: m.plan.name, planActive: m.plan.isActive, price: Number(m.plan.price),
        startDate: m.startDate, endDate: m.endDate, daysLeft, state: daysLeft < 0 ? 'EXPIRED' : 'EXPIRING',
        remindedAt: m.renewalReminderSentAt?.toISOString() ?? null,
      }
    })
}

export function parseLedgerFilters(sp: URLSearchParams): LedgerFilters {
  const list = (k: string, allowed: readonly string[]) => sp.get(k)?.split(',').filter((x) => allowed.includes(x))
  const from = sp.get('from'), to = sp.get('to')
  const kind = sp.get('kind')
  return {
    from: isLocalDate(from) ? from : undefined,
    to: isLocalDate(to) ? to : undefined,
    types: list('type', PAYMENT_TYPES) as PaymentType[] | undefined,
    methods: list('method', ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER']),
    kind: kind === 'PAYMENT' || kind === 'REFUND' ? kind : undefined,
    q: sp.get('q')?.trim().slice(0, 80) || undefined,
    sort: sp.get('sort') === 'amount' ? 'amount' : 'date',
    order: sp.get('order') === 'asc' ? 'asc' : 'desc',
  }
}
