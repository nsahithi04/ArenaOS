import { isLocalDate, parseClock } from '@/lib/booking/time'
import { parseMoney, PAYMENT_METHODS, ValidationError } from '@/lib/booking/validation'
import type { ShiftInput, TimeEntryInput } from './service'

type Obj = Record<string, unknown>
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/
function obj(b: unknown): Obj {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ValidationError({ body: 'Request body must be a JSON object' })
  return b as Obj
}
const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
function clock(v: unknown, end = false): number | null {
  if (typeof v !== 'string') return null
  const m = parseClock(v)
  return end && m === 0 ? 1440 : m
}

export function validateShift(body: unknown, partial = false): Partial<ShiftInput> {
  const o = obj(body)
  const e: Record<string, string> = {}
  const out: Partial<ShiftInput> = {}
  if (!partial || 'memberId' in o) { if (typeof o.memberId !== 'string' || !ID_RE.test(o.memberId)) e.memberId = 'Choose a team member'; else out.memberId = o.memberId }
  if (!partial || 'date' in o) { if (!isLocalDate(o.date)) e.date = 'Date is required'; else out.date = o.date }
  if (!partial || 'start' in o || 'end' in o) {
    const s = clock(o.start), en = clock(o.end, true)
    if (s == null) e.start = 'Start time is required'
    if (en == null) e.end = 'End time is required'
    if (s != null && en != null) {
      if (en <= s) e.end = 'End must be after start (shifts can’t cross midnight)'
      else if (en - s > 16 * 60) e.end = 'A shift can be at most 16 hours'
      else { out.startMin = s; out.endMin = en }
    }
  }
  if ('position' in o) out.position = text(o.position, 60)
  if ('notes' in o) out.notes = text(o.notes, 300)
  if (!partial) { out.position ??= null; out.notes ??= null }
  if (Object.keys(e).length) throw new ValidationError(e)
  return out
}

export function validateTimeEntry(body: unknown): TimeEntryInput {
  const o = obj(body)
  const e: Record<string, string> = {}
  if (typeof o.memberId !== 'string' || !ID_RE.test(o.memberId)) e.memberId = 'Choose a team member'
  if (!isLocalDate(o.date)) e.date = 'Date is required'
  const inMin = clock(o.clockIn)
  if (inMin == null) e.clockIn = 'Clock-in time is required'
  const outMin = o.clockOut === null || o.clockOut === '' || o.clockOut === undefined ? null : clock(o.clockOut, true)
  if (o.clockOut && outMin == null) e.clockOut = 'Clock-out time is invalid'
  if (Object.keys(e).length) throw new ValidationError(e)
  return { memberId: o.memberId as string, date: o.date as string, inMin: inMin!, outMin, note: text(o.note, 300) }
}

export function validatePay(body: unknown) {
  const o = obj(body)
  const e: Record<string, string> = {}
  const payType = o.payType === null || o.payType === '' ? null : o.payType === 'HOURLY' || o.payType === 'MONTHLY' ? o.payType : (e.payType = 'Pay type must be HOURLY or MONTHLY', null)
  const rate = o.payRate === null || o.payRate === '' || o.payRate === undefined ? null : parseMoney(o.payRate)
  if (rate !== null && (Number.isNaN(rate) || rate < 0 || rate > 1_000_000)) e.payRate = 'Rate must be a positive amount'
  if (Object.keys(e).length) throw new ValidationError(e)
  return { payType: payType as 'HOURLY' | 'MONTHLY' | null, payRate: rate, ...('position' in o && { position: text(o.position, 60) }) }
}

export function validatePayout(body: unknown) {
  const o = obj(body)
  const e: Record<string, string> = {}
  if (!isLocalDate(o.periodStart)) e.periodStart = 'Period start is required'
  if (!isLocalDate(o.periodEnd)) e.periodEnd = 'Period end is required'
  const amount = parseMoney(o.amount)
  if (amount === null || Number.isNaN(amount) || amount <= 0 || amount > 1_000_000) e.amount = 'Amount must be greater than 0'
  if (typeof o.method !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(o.method)) e.method = 'Choose a payment method'
  if (Object.keys(e).length) throw new ValidationError(e)
  return { periodStart: o.periodStart as string, periodEnd: o.periodEnd as string, amount: amount!, method: o.method as string, note: text(o.note, 300) }
}
