// Input validation for players, membership plans, memberships, classes and enrolments.

import { isLocalDate, parseClock } from '@/lib/booking/time'
import { parseMoney, PAYMENT_METHODS, ValidationError, type PaymentMethodValue } from '@/lib/booking/validation'
import { WEEKDAYS, type Weekday } from './schedule'

type Obj = Record<string, unknown>
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
const PHONE_RE = /^[0-9+()\-.\s]{5,30}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function obj(body: unknown): Obj {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError({ body: 'Request body must be a JSON object' })
  return body as Obj
}
function text(o: Obj, k: string, e: Record<string, string>, label: string, max: number, required = false): string | null {
  const v = o[k]
  if (v === undefined || v === null || (typeof v === 'string' && !v.trim())) {
    if (required) e[k] = `${label} is required`
    return null
  }
  if (typeof v !== 'string') { e[k] = `${label} must be text`; return null }
  if (v.trim().length > max) e[k] = `${label} must be at most ${max} characters`
  return v.trim()
}
function idOf(o: Obj, k: string, e: Record<string, string>, label: string, required = false): string | null {
  const v = o[k]
  if (v === undefined || v === null || v === '') { if (required) e[k] = `${label} is required`; return null }
  if (typeof v !== 'string' || !ID_RE.test(v)) { e[k] = `${label} is invalid`; return null }
  return v
}
function money(o: Obj, k: string, e: Record<string, string>, label: string, required = false): number | null {
  const v = parseMoney(o[k])
  if (v === null) { if (required) e[k] = `${label} is required`; return null }
  if (Number.isNaN(v) || v < 0 || v > 1_000_000) { e[k] = `${label} must be between 0 and 1,000,000`; return null }
  return v
}
function date(o: Obj, k: string, e: Record<string, string>, label: string): string | null {
  const v = o[k]
  if (!isLocalDate(v)) { e[k] = `${label} must be a date (YYYY-MM-DD)`; return null }
  return v
}
function done<T>(e: Record<string, string>, v: T): T {
  if (Object.keys(e).length) throw new ValidationError(e)
  return v
}

export type NewPlayer = { name: string; phone: string | null; email: string | null }
export type PlayerRef = { playerId: string } | { newPlayer: NewPlayer }
export type UpfrontPayment = { amount: number; method: PaymentMethodValue } | null

/** `{ playerId }` or `{ newPlayer: { name, phone?, email? } }` */
export function parsePlayerRef(o: Obj, e: Record<string, string>): PlayerRef | null {
  const pid = idOf(o, 'playerId', e, 'Player')
  if (pid) return { playerId: pid }
  const np = o.newPlayer
  if (!np || typeof np !== 'object') { e.player = 'Choose a player or enter a new one'; return null }
  const n = np as Obj
  const name = text(n, 'name', e, 'Player name', 120, true)
  const phone = text(n, 'phone', e, 'Phone', 30)
  if (phone && !PHONE_RE.test(phone)) e.phone = 'Phone number looks invalid'
  const email = text(n, 'email', e, 'Email', 254)
  if (email && !EMAIL_RE.test(email)) e.email = 'Email looks invalid'
  return name ? { newPlayer: { name, phone, email: email?.toLowerCase() ?? null } } : null
}

function upfront(o: Obj, e: Record<string, string>): UpfrontPayment {
  const p = o.payment
  if (p === undefined || p === null) return null
  if (typeof p !== 'object') { e.payment = 'Invalid payment'; return null }
  const po = p as Obj
  const amount = parseMoney(po.amount)
  const method = po.method
  if (amount === null || Number.isNaN(amount) || amount <= 0) { e['payment.amount'] = 'Payment amount must be greater than 0'; return null }
  if (typeof method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(method)) { e['payment.method'] = 'Choose a payment method'; return null }
  return { amount, method: method as PaymentMethodValue }
}

// ─── Plans ──────────────────────────────────────────────────────────────────

export type PlanInput = { name: string; description: string | null; durationMonths: number; price: number; sportId: string | null; isActive: boolean }

export function validatePlan(body: unknown, partial = false): Partial<PlanInput> {
  const o = obj(body)
  const e: Record<string, string> = {}
  const out: Partial<PlanInput> = {}
  if (!partial || 'name' in o) { const v = text(o, 'name', e, 'Plan name', 80, true); if (v) out.name = v }
  if ('description' in o) out.description = text(o, 'description', e, 'Description', 300)
  if (!partial || 'durationMonths' in o) {
    const d = Number(o.durationMonths)
    if (!Number.isInteger(d) || d < 1 || d > 36) e.durationMonths = 'Duration must be 1–36 months'
    else out.durationMonths = d
  }
  if (!partial || 'price' in o) { const v = money(o, 'price', e, 'Price', true); if (v !== null) out.price = v }
  if ('sportId' in o) out.sportId = idOf(o, 'sportId', e, 'Sport')
  if ('isActive' in o) out.isActive = o.isActive === true
  return done(e, out)
}

// ─── Memberships ────────────────────────────────────────────────────────────

export type SellMembershipInput = { player: PlayerRef; planId: string; startDate: string; payment: UpfrontPayment }

export function validateSellMembership(body: unknown): SellMembershipInput {
  const o = obj(body)
  const e: Record<string, string> = {}
  const player = parsePlayerRef(o, e)
  const planId = idOf(o, 'planId', e, 'Plan', true)
  const startDate = date(o, 'startDate', e, 'Start date')
  const payment = upfront(o, e)
  return done(e, { player: player!, planId: planId!, startDate: startDate!, payment })
}

// ─── Classes ────────────────────────────────────────────────────────────────

export type ClassInput = {
  name: string; coachName: string | null; sportId: string | null; courtIds: string[]; days: Weekday[]
  startMin: number; endMin: number; startDate: string; endDate: string; capacity: number | null; fee: number; feePeriod: 'MONTH' | 'TERM'
}

export function validateClass(body: unknown, partial = false): Partial<ClassInput> & { skipConflicts: boolean } {
  const o = obj(body)
  const e: Record<string, string> = {}
  const out: Partial<ClassInput> = {}
  const has = (k: string) => !partial || k in o
  if (has('name')) { const v = text(o, 'name', e, 'Class name', 80, true); if (v) out.name = v }
  if ('coachName' in o) out.coachName = text(o, 'coachName', e, 'Coach', 80)
  if ('sportId' in o) out.sportId = idOf(o, 'sportId', e, 'Sport')
  if (has('courtIds')) {
    const c = o.courtIds
    if (!Array.isArray(c) || !c.length || c.length > 20 || c.some((x) => typeof x !== 'string' || !ID_RE.test(x))) e.courtIds = 'Choose at least one court'
    else out.courtIds = [...new Set(c as string[])]
  }
  if (has('days')) {
    const d = o.days
    if (!Array.isArray(d) || !d.length || d.some((x) => !(WEEKDAYS as readonly unknown[]).includes(x))) e.days = 'Choose at least one day'
    else out.days = [...new Set(d as Weekday[])]
  }
  if (has('start') || has('end')) {
    const s = typeof o.start === 'string' ? parseClock(o.start) : null
    let en = typeof o.end === 'string' ? parseClock(o.end) : null
    if (en === 0) en = 1440
    if (s == null) e.start = 'Start time is required'
    if (en == null) e.end = 'End time is required'
    if (s != null && en != null) {
      if (en <= s) e.end = 'End time must be after start time'
      else if (en - s < 15) e.end = 'Sessions must be at least 15 minutes'
      else { out.startMin = s; out.endMin = en }
    }
  }
  if (has('startDate')) { const v = date(o, 'startDate', e, 'Start date'); if (v) out.startDate = v }
  if (has('endDate')) { const v = date(o, 'endDate', e, 'End date'); if (v) out.endDate = v }
  if (out.startDate && out.endDate) {
    if (out.endDate < out.startDate) e.endDate = 'End date must be on or after the start date'
    else if (Date.parse(out.endDate) - Date.parse(out.startDate) > 366 * 86400000) e.endDate = 'A class term can be at most one year'
  }
  if ('capacity' in o) {
    if (o.capacity === null || o.capacity === '') out.capacity = null
    else {
      const c = Number(o.capacity)
      if (!Number.isInteger(c) || c < 1 || c > 500) e.capacity = 'Capacity must be 1–500'
      else out.capacity = c
    }
  }
  if (has('fee')) { const v = money(o, 'fee', e, 'Fee', true); if (v !== null) out.fee = v }
  if ('feePeriod' in o) {
    if (o.feePeriod !== 'MONTH' && o.feePeriod !== 'TERM') e.feePeriod = 'Fee period must be MONTH or TERM'
    else out.feePeriod = o.feePeriod
  }
  return done(e, { ...out, skipConflicts: o.skipConflicts === true })
}

export type EnrollInput = { player: PlayerRef; payment: UpfrontPayment }

export function validateEnroll(body: unknown): EnrollInput {
  const o = obj(body)
  const e: Record<string, string> = {}
  const player = parsePlayerRef(o, e)
  const payment = upfront(o, e)
  return done(e, { player: player!, payment })
}

export function validateClubPayment(body: unknown): { amount: number; method: PaymentMethodValue; note: string | null } {
  const o = obj(body)
  const e: Record<string, string> = {}
  const amount = parseMoney(o.amount)
  if (amount === null || Number.isNaN(amount) || amount <= 0 || amount > 1_000_000) e.amount = 'Amount must be greater than 0'
  if (typeof o.method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(o.method)) e.method = 'Choose a payment method'
  const note = text(o, 'note', e, 'Note', 300)
  return done(e, { amount: amount!, method: o.method as PaymentMethodValue, note })
}
