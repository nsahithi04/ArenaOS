import { isLocalDate, parseClock } from '@/lib/booking/time'
import { parseMoney, ValidationError } from '@/lib/booking/validation'
import { parsePlayerRef, type PlayerRef, type UpfrontPayment } from '@/lib/club/validation'
import { PAYMENT_METHODS, type PaymentMethodValue } from '@/lib/booking/validation'

type Obj = Record<string, unknown>
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

function obj(body: unknown): Obj {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError({ body: 'Request body must be a JSON object' })
  return body as Obj
}
function done<T>(e: Record<string, string>, v: T): T {
  if (Object.keys(e).length) throw new ValidationError(e)
  return v
}

export type Prize = { label: string; amount: number; paid: boolean }

export type TournamentInput = {
  name: string; description: string | null; sportId: string | null; courtIds: string[]
  startDate: string; endDate: string; startMin: number; endMin: number
  entryType: 'SINGLES' | 'DOUBLES' | 'TEAM'; maxEntrants: number | null; entryFee: number; prizes: Prize[]
}

export function validateTournament(body: unknown, partial = false): Partial<TournamentInput> & { skipConflicts: boolean } {
  const o = obj(body)
  const e: Record<string, string> = {}
  const out: Partial<TournamentInput> = {}
  const has = (k: string) => !partial || k in o

  if (has('name')) {
    const v = typeof o.name === 'string' ? o.name.trim() : ''
    if (!v || v.length > 100) e.name = 'Tournament name is required (max 100 characters)'
    else out.name = v
  }
  if ('description' in o) {
    const v = typeof o.description === 'string' ? o.description.trim() : ''
    if (v.length > 1000) e.description = 'Description is too long'
    out.description = v || null
  }
  if ('sportId' in o) {
    if (o.sportId === null || o.sportId === '') out.sportId = null
    else if (typeof o.sportId !== 'string' || !ID_RE.test(o.sportId)) e.sportId = 'Sport is invalid'
    else out.sportId = o.sportId
  }
  if (has('courtIds')) {
    const c = o.courtIds
    if (!Array.isArray(c) || !c.length || c.length > 30 || c.some((x) => typeof x !== 'string' || !ID_RE.test(x))) e.courtIds = 'Choose at least one court'
    else out.courtIds = [...new Set(c as string[])]
  }
  if (has('startDate')) { if (!isLocalDate(o.startDate)) e.startDate = 'Start date is required'; else out.startDate = o.startDate }
  if (has('endDate')) { if (!isLocalDate(o.endDate)) e.endDate = 'End date is required'; else out.endDate = o.endDate }
  if (out.startDate && out.endDate) {
    if (out.endDate < out.startDate) e.endDate = 'End date must be on or after the start date'
    else if (Date.parse(out.endDate) - Date.parse(out.startDate) > 60 * 86400000) e.endDate = 'A tournament can run at most 60 days'
  }
  if (has('start') || has('end')) {
    const s = typeof o.start === 'string' ? parseClock(o.start) : null
    let en = typeof o.end === 'string' ? parseClock(o.end) : null
    if (en === 0) en = 1440
    if (s == null) e.start = 'Daily start time is required'
    if (en == null) e.end = 'Daily end time is required'
    if (s != null && en != null) {
      if (en <= s) e.end = 'End time must be after start time'
      else { out.startMin = s; out.endMin = en }
    }
  }
  if ('entryType' in o) {
    if (!['SINGLES', 'DOUBLES', 'TEAM'].includes(o.entryType as string)) e.entryType = 'Entry type must be SINGLES, DOUBLES or TEAM'
    else out.entryType = o.entryType as TournamentInput['entryType']
  }
  if ('maxEntrants' in o) {
    if (o.maxEntrants === null || o.maxEntrants === '') out.maxEntrants = null
    else {
      const n = Number(o.maxEntrants)
      if (!Number.isInteger(n) || n < 2 || n > 256) e.maxEntrants = 'Maximum entries must be 2–256'
      else out.maxEntrants = n
    }
  }
  if (has('entryFee')) {
    const v = parseMoney(o.entryFee)
    if (v === null || Number.isNaN(v) || v < 0 || v > 1_000_000) e.entryFee = 'Entry fee is required (0 if free)'
    else out.entryFee = v
  }
  if ('prizes' in o) {
    const p = o.prizes
    if (!Array.isArray(p) || p.length > 10) e.prizes = 'Prizes must be a list (max 10)'
    else {
      const list: Prize[] = []
      for (const x of p as Obj[]) {
        const label = typeof x?.label === 'string' ? x.label.trim() : ''
        const amount = parseMoney(x?.amount)
        if (!label || label.length > 40 || amount === null || Number.isNaN(amount) || amount < 0 || amount > 10_000_000) { e.prizes = 'Each prize needs a label and an amount'; break }
        list.push({ label, amount, paid: x.paid === true })
      }
      out.prizes = list
    }
  }
  return done(e, { ...out, skipConflicts: o.skipConflicts === true })
}

export type EntrantInput = { name: string; player: PlayerRef | null; phone: string | null; seed: number | null; payment: UpfrontPayment }

/** An entry: a display name (pair/team name) plus an optional linked player (main contact). */
export function validateEntrant(body: unknown): EntrantInput {
  const o = obj(body)
  const e: Record<string, string> = {}
  let player: PlayerRef | null = null
  if (o.playerId || o.newPlayer) player = parsePlayerRef(o, e)
  const nameRaw = typeof o.name === 'string' ? o.name.trim() : ''
  const name = nameRaw || (player && 'newPlayer' in player ? player.newPlayer.name : '')
  if (!name && !(player && 'playerId' in player)) e.name = 'Entry name is required'
  if (name.length > 120) e.name = 'Entry name is too long'
  const phone = typeof o.phone === 'string' && o.phone.trim() ? o.phone.trim().slice(0, 30) : null
  let seed: number | null = null
  if (o.seed !== undefined && o.seed !== null && o.seed !== '') {
    const n = Number(o.seed)
    if (!Number.isInteger(n) || n < 1 || n > 256) e.seed = 'Seed must be 1–256'
    else seed = n
  }
  let payment: UpfrontPayment = null
  if (o.payment) {
    const po = o.payment as Obj
    const amount = parseMoney(po.amount)
    if (amount === null || Number.isNaN(amount) || amount <= 0) e['payment.amount'] = 'Payment amount must be greater than 0'
    else if (typeof po.method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(po.method)) e['payment.method'] = 'Choose a payment method'
    else payment = { amount, method: po.method as PaymentMethodValue }
  }
  return done(e, { name, player, phone, seed, payment })
}

export type ResultInput = { winnerId: string; score: string | null; walkover: boolean } | { undo: true }
export type ScheduleInput = { courtId: string | null; date: string | null; start: number | null }

export function validateMatchUpdate(body: unknown): { result?: ResultInput; schedule?: ScheduleInput } {
  const o = obj(body)
  const e: Record<string, string> = {}
  const out: { result?: ResultInput; schedule?: ScheduleInput } = {}
  if (o.undo === true) out.result = { undo: true }
  else if ('winnerId' in o) {
    if (typeof o.winnerId !== 'string' || !ID_RE.test(o.winnerId)) e.winnerId = 'Choose the winner'
    const score = typeof o.score === 'string' && o.score.trim() ? o.score.trim().slice(0, 60) : null
    out.result = { winnerId: o.winnerId as string, score, walkover: o.walkover === true }
  }
  if ('courtId' in o || 'date' in o || 'start' in o) {
    const courtId = o.courtId === null || o.courtId === '' || o.courtId === undefined ? null : typeof o.courtId === 'string' && ID_RE.test(o.courtId) ? o.courtId : (e.courtId = 'Court is invalid', null)
    const date = o.date === null || o.date === '' || o.date === undefined ? null : isLocalDate(o.date) ? o.date : (e.date = 'Date must be YYYY-MM-DD', null)
    const start = o.start === null || o.start === '' || o.start === undefined ? null : typeof o.start === 'string' && parseClock(o.start) != null ? parseClock(o.start) : (e.start = 'Time must be HH:mm', null)
    if ((date == null) !== (start == null) && !e.date && !e.start) e.start = 'Give both a date and a time, or neither'
    out.schedule = { courtId, date, start }
  }
  if (!out.result && !out.schedule) e.body = 'Nothing to update'
  return done(e, out)
}
