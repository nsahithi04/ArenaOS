// Tournaments end to end: court reservation, entries & fees, draw, results, champion, revenue.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))

import * as tournaments from '@/app/api/tournaments/route'
import * as tournamentById from '@/app/api/tournaments/[id]/route'
import * as entrants from '@/app/api/tournaments/[id]/entrants/route'
import * as entrantById from '@/app/api/tournaments/[id]/entrants/[entrantId]/route'
import * as entryPayments from '@/app/api/tournaments/[id]/entrants/[entrantId]/payments/route'
import * as draw from '@/app/api/tournaments/[id]/draw/route'
import * as matchById from '@/app/api/tournaments/[id]/matches/[matchId]/route'
import * as bookings from '@/app/api/bookings/route'
import * as blockById from '@/app/api/court-blocks/[id]/route'
import * as dashboard from '@/app/api/dashboard/route'
import { ensurePresetRoles } from '@/lib/team/presets'
import { addDays, todayIn } from '@/lib/booking/time'
import { prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const as = (id: string | null) => { session.userId = id }
const req = (method: string, path: string, body?: unknown) =>
  new Request(`http://t${path}`, { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }) })
const p1 = (id: string) => ({ params: Promise.resolve({ id }) })
const pE = (id: string, entrantId: string) => ({ params: Promise.resolve({ id, entrantId }) })
const pM = (id: string, matchId: string) => ({ params: Promise.resolve({ id, matchId }) })

type Detail = {
  status: string; winnerName: string | null; totalRounds: number
  entrants: { id: string; name: string; seed: number | null; paid: number; balance: number }[]
  rounds: { name: string; matches: { id: string; entrantAId: string | null; entrantBId: string | null; winnerId: string | null; status: string; score: string | null }[] }[]
  placings: { label: string; names: string[]; prize: { label: string; amount: number } | null }[]
}

let V: Awaited<ReturnType<typeof seedVenue>>
let employee: { id: string }
let today: string
let tid: string
const detail = async () => (await (await tournamentById.GET(req('GET', '/x'), p1(tid))).json()) as Detail

describe.skipIf(!enabled)('tournaments', () => {
  beforeAll(async () => {
    await resetDatabase()
    V = await seedVenue('cup')
    today = todayIn(V.venue.timezone)
    await ensurePresetRoles(prisma, V.venue.id)
    const role = await prisma.venueRole.findFirstOrThrow({ where: { venueId: V.venue.id, preset: 'EMPLOYEE' } })
    employee = await prisma.user.create({ data: { email: 'emp@cup.test', name: 'Emp' } })
    await prisma.venueMember.create({ data: { venueId: V.venue.id, userId: employee.id, roleId: role.id, email: 'emp@cup.test', name: 'Emp', status: 'active' } })
  })
  afterAll(async () => { await prisma.$disconnect() })

  const body = () => ({
    name: 'Winter Open', courtIds: [V.court1.id, V.court2.id], startDate: addDays(today, 3), endDate: addDays(today, 4),
    start: '09:00', end: '18:00', entryType: 'SINGLES', maxEntrants: 6, entryFee: 25,
    prizes: [{ label: 'Winner', amount: 300 }, { label: 'Runner-up', amount: 100 }],
  })

  it('reserves its courts every day of the window, after reporting clashes', async () => {
    as(V.owner.id)
    await bookings.POST(req('POST', '/api/bookings', { courtId: V.court2.id, customer: 'In the way', source: 'PHONE', date: addDays(today, 4), start: '10:00', end: '11:00' }))
    as(employee.id)
    expect((await tournaments.POST(req('POST', '/x', body()))).status).toBe(403)
    as(V.owner.id)
    const refused = await tournaments.POST(req('POST', '/x', body()))
    expect(refused.status).toBe(409)
    const refusedBody = await refused.json()
    expect(refusedBody.details.conflicts).toEqual([expect.objectContaining({ what: 'Booking: In the way', courtName: 'Court 2 · Pickleball', time: '10:00 AM – 11:00 AM' })])
    // The message itself names the court, day, time and what is in the way.
    expect(refusedBody.error).toMatch(/^1 clash with existing bookings or blocks: Court 2 · Pickleball on \w{3}, \w{3} \d+, 10:00 AM – 11:00 AM \(Booking: In the way\)\.$/)
    const ok = await tournaments.POST(req('POST', '/x', { ...body(), skipConflicts: true }))
    expect(ok.status).toBe(201)
    const r = await ok.json()
    tid = r.id
    // 3 clean court-days + the clashing court-day reserved around the booking (9–10 and 11–6).
    expect(r).toMatchObject({ sessions: 5, skipped: 0, trimmed: 1 })
    const around = await prisma.courtBlock.findMany({ where: { tournamentId: tid, courtId: V.court2.id }, orderBy: { startTime: 'asc' } })
    const hrs = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: V.venue.timezone, hour: 'numeric', hour12: false }).format(d)
    expect(around.map((b) => `${hrs(b.startTime)}-${hrs(b.endTime)}`)).toEqual(['09-18', '09-10', '11-18'])

    const blocked = await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'X', source: 'PHONE', date: addDays(today, 3), start: '12:00', end: '13:00' }))
    expect(blocked.status).toBe(409)
    expect((await blocked.json()).error).toContain('Winter Open')
    const block = await prisma.courtBlock.findFirstOrThrow({ where: { tournamentId: tid } })
    expect((await blockById.DELETE(req('DELETE', '/x'), p1(block.id))).status).toBe(409)
  })

  it('sees class and maintenance blocks as clashes, naming them', async () => {
    as(V.owner.id)
    const d = addDays(today, 20)
    const at = (h: number) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00Z`)
    await prisma.courtBlock.create({ data: { venueId: V.venue.id, courtId: V.court1.id, startTime: at(17), endTime: at(18), reason: 'Maintenance', createdById: V.owner.id } })
    const res = await tournaments.POST(req('POST', '/x', { ...body(), name: 'Clashy', courtIds: [V.court1.id], startDate: d, endDate: d, start: '00:00', end: '23:00' }))
    expect(res.status).toBe(409)
    const j = await res.json()
    expect(j.details.conflicts).toEqual([expect.objectContaining({ what: 'Maintenance', courtName: 'Court 1 · Pickleball' })])
    expect(j.error).toContain('(Maintenance)')
  })

  it('registers entries with fees, seeds and a capacity limit', async () => {
    as(employee.id)
    const names = ['Asha', 'Ben', 'Cara', 'Dev', 'Eli']
    for (const [i, n] of names.entries()) {
      const r = await entrants.POST(req('POST', '/x', { newPlayer: { name: n }, seed: i === 0 ? 1 : i === 1 ? 2 : undefined, payment: i < 4 ? { amount: 25, method: 'CASH' } : undefined }), p1(tid))
      expect(r.status).toBe(201)
    }
    // Seed clash and overpayment are refused
    expect((await entrants.POST(req('POST', '/x', { name: 'Fay', seed: 1 }), p1(tid))).status).toBe(409)
    expect((await entrants.POST(req('POST', '/x', { name: 'Fay', payment: { amount: 30, method: 'CASH' } }), p1(tid))).status).toBe(422)
    // The same person can't be entered twice: by name (any case/spacing), linked player or phone.
    const dupName = await entrants.POST(req('POST', '/x', { newPlayer: { name: '  ' + names[0].toUpperCase() } }), p1(tid))
    expect(dupName.status).toBe(409)
    expect((await dupName.json()).error).toContain('is already entered in this tournament')
    const first = await prisma.tournamentEntrant.findFirstOrThrow({ where: { tournamentId: tid, playerId: { not: null } }, orderBy: { createdAt: 'asc' } })
    expect((await entrants.POST(req('POST', '/x', { playerId: first.playerId }), p1(tid))).status).toBe(409)
    const playersBefore = await prisma.player.count({ where: { venueId: V.venue.id } })
    await prisma.tournamentEntrant.update({ where: { id: first.id }, data: { phone: '+1 480 555 0199' } })
    const dupPhone = await entrants.POST(req('POST', '/x', { newPlayer: { name: 'Someone Else', phone: '480-555-0199' } }), p1(tid))
    expect(dupPhone.status).toBe(409)
    expect((await dupPhone.json()).error).toContain(`(as ${first.name})`)
    expect(await prisma.player.count({ where: { venueId: V.venue.id } })).toBe(playersBefore) // nothing left behind
    expect((await entrants.POST(req('POST', '/x', { name: 'Fay' }), p1(tid))).status).toBe(201)
    expect((await entrants.POST(req('POST', '/x', { name: 'Gus' }), p1(tid))).status).toBe(409) // full at 6
    const d = await detail()
    const eli = d.entrants.find((e) => e.name === 'Eli')!
    expect(eli).toMatchObject({ paid: 0, balance: 25 })
    expect((await entryPayments.POST(req('POST', '/x', { amount: 25, method: 'UPI' }), pE(tid, eli.id))).status).toBe(201)
    // Withdraw Fay before the draw
    const fay = d.entrants.find((e) => e.name === 'Fay')!
    expect((await entrantById.PATCH(req('PATCH', '/x', { withdrawn: true }), pE(tid, fay.id))).status).toBe(200)
  })

  it('draws a seeded knockout with byes; only managers can draw', async () => {
    as(employee.id)
    expect((await draw.POST(req('POST', '/x', {}), p1(tid))).status).toBe(403)
    as(V.owner.id)
    const r = await draw.POST(req('POST', '/x', { random: false }), p1(tid))
    expect(r.status).toBe(200)
    const d = await detail()
    expect(d.status).toBe('IN_PROGRESS')
    expect(d.totalRounds).toBe(3) // 5 entries → bracket of 8
    expect(d.rounds.map((x) => x.name)).toEqual(['Quarter-finals', 'Semi-finals', 'Final'])
    const byes = d.rounds[0].matches.filter((m) => m.score === 'Bye')
    expect(byes).toHaveLength(3)
    const asha = d.entrants.find((e) => e.name === 'Asha')!
    expect(byes.map((b) => b.winnerId)).toContain(asha.id) // top seed gets a bye
    // Registration is now closed
    as(employee.id)
    expect((await entrants.POST(req('POST', '/x', { name: 'Late' }), p1(tid))).status).toBe(422)
  })

  it('reopens registration after the draw, until a result is recorded', async () => {
    as(employee.id)
    expect((await draw.DELETE(req('DELETE', '/x'), p1(tid))).status).toBe(403)
    as(V.owner.id)
    const res = await draw.DELETE(req('DELETE', '/x'), p1(tid))
    expect(res.status).toBe(200)
    let d = await detail()
    expect(d.status).toBe('REGISTRATION')
    expect(d.rounds).toHaveLength(0)
    expect(d.entrants.length).toBeGreaterThan(1) // entries are kept
    expect((await draw.POST(req('POST', '/x', { random: false }), p1(tid))).status).toBe(200)
    d = await detail()
    expect(d.status).toBe('IN_PROGRESS')
  })

  it('records results, advances winners, guards corrections, and crowns a champion', async () => {
    as(employee.id)
    let d = await detail()
    const real = d.rounds[0].matches.find((m) => m.status === 'PENDING' && m.entrantAId && m.entrantBId)!
    // Winner must be in the match
    const outsider = d.entrants.find((e) => e.id !== real.entrantAId && e.id !== real.entrantBId)!
    const wrong = await matchById.PATCH(req('PATCH', '/x', { winnerId: outsider.id }), pM(tid, real.id))
    expect(wrong.status).toBe(422)
    expect((await wrong.json()).code).toBe('NOT_IN_MATCH')
    expect((await matchById.PATCH(req('PATCH', '/x', { winnerId: real.entrantBId, score: '21-17, 21-19' }), pM(tid, real.id))).status).toBe(200)
    // A bye can't be "played"
    const bye = d.rounds[0].matches.find((m) => m.score === 'Bye')!
    expect((await matchById.PATCH(req('PATCH', '/x', { winnerId: bye.winnerId }), pM(tid, bye.id))).status).toBe(422)
    // Redraw no longer allowed
    as(V.owner.id)
    expect((await draw.POST(req('POST', '/x', {}), p1(tid))).status).toBe(422)
    const reopen = await draw.DELETE(req('DELETE', '/x'), p1(tid))
    expect(reopen.status).toBe(422)
    expect((await reopen.json()).error).toContain('1 result has been recorded')

    // Play the semi-finals
    as(employee.id)
    d = await detail()
    for (const m of d.rounds[1].matches) {
      expect(m.entrantAId && m.entrantBId).toBeTruthy()
      expect((await matchById.PATCH(req('PATCH', '/x', { winnerId: m.entrantAId, score: '2-0' }), pM(tid, m.id))).status).toBe(200)
    }
    // Round 1 result can't change once the semi it fed is played
    expect((await matchById.PATCH(req('PATCH', '/x', { undo: true }), pM(tid, real.id))).status).toBe(422)
    // Schedule the final on a tournament court; other courts are refused
    d = await detail()
    const final = d.rounds[2].matches[0]
    expect((await matchById.PATCH(req('PATCH', '/x', { courtId: V.court1.id, date: addDays(today, 4), start: '16:00' }), pM(tid, final.id))).status).toBe(200)
    const otherCourt = await prisma.court.create({ data: { venueId: V.venue.id, name: 'Court 9' } })
    expect((await matchById.PATCH(req('PATCH', '/x', { courtId: otherCourt.id }), pM(tid, final.id))).status).toBe(422)

    // Final by walkover → champion, placings and prizes
    expect((await matchById.PATCH(req('PATCH', '/x', { winnerId: final.entrantBId, walkover: true }), pM(tid, final.id))).status).toBe(200)
    d = await detail()
    expect(d.status).toBe('COMPLETED')
    const champ = d.entrants.find((e) => e.id === final.entrantBId)!.name
    expect(d.winnerName).toBe(champ)
    expect(d.placings[0]).toMatchObject({ label: 'Winner', names: [champ], prize: { label: 'Winner', amount: 300 } })
    expect(d.placings[1]).toMatchObject({ label: 'Runner-up', prize: { amount: 100 } })
    expect(d.rounds[2].matches[0].score).toBe('W/O')

    // Undoing the final reopens the tournament
    expect((await matchById.PATCH(req('PATCH', '/x', { undo: true }), pM(tid, final.id))).status).toBe(200)
    expect((await detail()).status).toBe('IN_PROGRESS')
    expect((await matchById.PATCH(req('PATCH', '/x', { winnerId: final.entrantAId, score: '21-10' }), pM(tid, final.id))).status).toBe(200)
  })

  it('entry fees show as Tournaments revenue', async () => {
    as(V.owner.id)
    const d = await (await dashboard.GET(req('GET', '/api/dashboard?range=today'))).json()
    const t = d.current.byType.find((x: { key: string }) => x.key === 'TOURNAMENT')
    expect(t.collected).toBe(125) // 5 × 25 (Fay never paid)
  })

  it('cancelling releases the courts', async () => {
    as(V.owner.id)
    const r = await tournaments.POST(req('POST', '/x', { ...body(), name: 'Spring Cup', startDate: addDays(today, 10), endDate: addDays(today, 10) }))
    const { id } = await r.json()
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'X', source: 'PHONE', date: addDays(today, 10), start: '09:00', end: '10:00' }))).status).toBe(409)
    expect((await tournamentById.DELETE(req('DELETE', '/x'), p1(id))).status).toBe(200)
    expect((await bookings.POST(req('POST', '/api/bookings', { courtId: V.court1.id, customer: 'X', source: 'PHONE', date: addDays(today, 10), start: '09:00', end: '10:00' }))).status).toBe(201)
  })
})
