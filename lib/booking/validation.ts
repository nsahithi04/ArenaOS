// Input validation for booking APIs. Hand-rolled to avoid a new dependency.

import { isLocalDate, parseClock } from './time'

export const BOOKING_SOURCES = ['WALK_IN', 'PHONE', 'WHATSAPP', 'GAMEON', 'PLAYO', 'DISTRICT', 'OTHER'] as const
export type BookingSourceValue = (typeof BOOKING_SOURCES)[number]
/** Bookings that came in through an online channel / aggregator. */
export const ONLINE_SOURCES: readonly BookingSourceValue[] = ['GAMEON', 'PLAYO', 'DISTRICT']
export const OFFLINE_SOURCES: readonly BookingSourceValue[] = ['WALK_IN', 'PHONE', 'WHATSAPP']

export const BOOKING_STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED'] as const
export type BookingStatusValue = (typeof BOOKING_STATUSES)[number]
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'REFUNDED'] as const
export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'ONLINE', 'OTHER'] as const
export type PaymentMethodValue = (typeof PAYMENT_METHODS)[number]

export const MIN_DURATION = 15
export const MAX_DURATION = 12 * 60

export class ValidationError extends Error {
  constructor(public fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Invalid input')
  }
}

type Obj = Record<string, unknown>

function str(o: Obj, key: string, errors: Record<string, string>, opts: { required?: boolean; max: number; label: string }): string | null {
  const v = o[key]
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (opts.required) errors[key] = `${opts.label} is required`
    return null
  }
  if (typeof v !== 'string') {
    errors[key] = `${opts.label} must be text`
    return null
  }
  const t = v.trim()
  if (t.length > opts.max) errors[key] = `${opts.label} must be at most ${opts.max} characters`
  return t
}

function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], errors: Record<string, string>, label: string, required = false): T | null {
  const v = o[key]
  if (v === undefined || v === null || v === '') {
    if (required) errors[key] = `${label} is required`
    return null
  }
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    errors[key] = `${label} must be one of: ${allowed.join(', ')}`
    return null
  }
  return v as T
}

export function parseMoney(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * 100) / 100
}

const PHONE_RE = /^[0-9+()\-.\s]{5,30}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/

function id(o: Obj, key: string, errors: Record<string, string>, label: string, required: boolean): string | null {
  const v = o[key]
  if (v === undefined || v === null || v === '') {
    if (required) errors[key] = `${label} is required`
    return null
  }
  if (typeof v !== 'string' || !ID_RE.test(v)) {
    errors[key] = `${label} is invalid`
    return null
  }
  return v
}

function timeWindow(o: Obj, errors: Record<string, string>, required: boolean) {
  const date = o.date
  const start = o.start
  const end = o.end
  const duration = o.durationMinutes
  const any = date !== undefined || start !== undefined || end !== undefined || duration !== undefined
  if (!any && !required) return null

  if (!isLocalDate(date)) errors.date = 'Date must be YYYY-MM-DD'
  const startMin = typeof start === 'string' ? parseClock(start) : null
  if (startMin == null || startMin >= 1440) errors.start = 'Start time must be HH:mm'

  let endMin: number | null = null
  if (end !== undefined && end !== null && end !== '') {
    endMin = typeof end === 'string' ? parseClock(end) : null
    if (endMin === 0) endMin = 1440 // "00:00" end = midnight
    if (endMin == null) errors.end = 'End time must be HH:mm'
  } else if (duration !== undefined) {
    const d = Number(duration)
    if (!Number.isInteger(d)) errors.durationMinutes = 'Duration must be whole minutes'
    else if (startMin != null) endMin = startMin + d
  } else {
    errors.end = 'End time or duration is required'
  }

  if (startMin != null && endMin != null && !errors.end && !errors.durationMinutes) {
    const dur = endMin - startMin
    if (dur <= 0) errors.end = 'End time must be after start time'
    else if (endMin > 1440) errors.end = 'Bookings cannot run past midnight'
    else if (dur < MIN_DURATION) errors.end = `Minimum booking is ${MIN_DURATION} minutes`
    else if (dur > MAX_DURATION) errors.end = `Maximum booking is ${MAX_DURATION / 60} hours`
    else if (startMin % 5 !== 0 || endMin % 5 !== 0) errors.start = 'Times must be in 5-minute steps'
  }
  if (errors.date || errors.start || errors.end || errors.durationMinutes) return null
  return { date: date as string, startMin: startMin as number, endMin: endMin as number }
}

export type InitialPayment = { amount: number; method: PaymentMethodValue }

export type CreateBookingInput = {
  venueId: string | null
  courtId: string
  sportId: string | null
  customer: string
  phone: string | null
  email: string | null
  source: BookingSourceValue
  date: string
  startMin: number
  endMin: number
  amount: number | null // null → computed from pricing rules
  status: 'PENDING' | 'CONFIRMED'
  notes: string | null
  overrideHours: boolean
  initialPayment: InitialPayment | null
  /** When set, the court time is covered by this membership (price 0). */
  membershipId: string | null
}

function contact(o: Obj, errors: Record<string, string>) {
  const phone = str(o, 'phone', errors, { max: 30, label: 'Phone' })
  if (phone && !PHONE_RE.test(phone)) errors.phone = 'Phone number looks invalid'
  const email = str(o, 'email', errors, { max: 254, label: 'Email' })
  if (email && !EMAIL_RE.test(email)) errors.email = 'Email looks invalid'
  return { phone, email: email?.toLowerCase() ?? null }
}

function amountField(o: Obj, key: string, errors: Record<string, string>, label: string): number | null {
  const a = parseMoney(o[key])
  if (a === null) return null
  if (Number.isNaN(a) || a < 0 || a > 1_000_000) {
    errors[key] = `${label} must be between 0 and 1,000,000`
    return null
  }
  return a
}

function initialPayment(o: Obj, errors: Record<string, string>): InitialPayment | null {
  const p = o.initialPayment
  if (p === undefined || p === null) return null
  if (typeof p !== 'object') {
    errors.initialPayment = 'Invalid payment'
    return null
  }
  const po = p as Obj
  const amount = parseMoney(po.amount)
  const method = oneOf(po, 'method', PAYMENT_METHODS, errors, 'Payment method', true)
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    errors['initialPayment.amount'] = 'Payment amount must be greater than 0'
    return null
  }
  if (!method) return null
  return { amount, method }
}

export function validateCreateBooking(body: unknown): CreateBookingInput {
  if (!body || typeof body !== 'object') throw new ValidationError({ body: 'Request body must be a JSON object' })
  const o = body as Obj
  const errors: Record<string, string> = {}

  const venueId = id(o, 'venueId', errors, 'Venue', false)
  const courtId = id(o, 'courtId', errors, 'Court', true)
  const sportId = id(o, 'sportId', errors, 'Sport', false)
  const customer = str(o, 'customer', errors, { required: true, max: 120, label: 'Customer name' })
  const { phone, email } = contact(o, errors)
  const source = oneOf(o, 'source', BOOKING_SOURCES, errors, 'Booking source', true)
  const win = timeWindow(o, errors, true)
  const amount = amountField(o, 'amount', errors, 'Amount')
  const status = oneOf(o, 'status', ['PENDING', 'CONFIRMED'] as const, errors, 'Status') ?? 'CONFIRMED'
  const notes = str(o, 'notes', errors, { max: 1000, label: 'Notes' })
  const pay = initialPayment(o, errors)
  const membershipId = id(o, 'membershipId', errors, 'Membership', false)
  if (membershipId && pay) errors.initialPayment = 'Member bookings are covered by the membership; no payment needed'

  if (Object.keys(errors).length) throw new ValidationError(errors)
  return {
    membershipId,
    venueId,
    courtId: courtId!,
    sportId,
    customer: customer!,
    phone,
    email,
    source: source!,
    date: win!.date,
    startMin: win!.startMin,
    endMin: win!.endMin,
    amount,
    status,
    notes,
    overrideHours: o.overrideHours === true,
    initialPayment: pay,
  }
}

export type UpdateBookingInput = {
  customer?: string
  phone?: string | null
  email?: string | null
  sportId?: string | null
  source?: BookingSourceValue
  notes?: string | null
  amount?: number // explicit price override
  recalculatePrice?: boolean
  courtId?: string
  window?: { date: string; startMin: number; endMin: number }
  status?: BookingStatusValue
  cancelReason?: string | null
  overrideHours: boolean
}

export function validateUpdateBooking(body: unknown): UpdateBookingInput {
  if (!body || typeof body !== 'object') throw new ValidationError({ body: 'Request body must be a JSON object' })
  const o = body as Obj
  const errors: Record<string, string> = {}
  const out: UpdateBookingInput = { overrideHours: o.overrideHours === true }

  if ('customer' in o) {
    const c = str(o, 'customer', errors, { required: true, max: 120, label: 'Customer name' })
    if (c) out.customer = c
  }
  if ('phone' in o || 'email' in o) {
    const { phone, email } = contact(o, errors)
    if ('phone' in o) out.phone = phone
    if ('email' in o) out.email = email
  }
  if ('sportId' in o) out.sportId = id(o, 'sportId', errors, 'Sport', false)
  if ('source' in o) {
    const s = oneOf(o, 'source', BOOKING_SOURCES, errors, 'Booking source', true)
    if (s) out.source = s
  }
  if ('notes' in o) out.notes = str(o, 'notes', errors, { max: 1000, label: 'Notes' })
  if ('amount' in o) {
    const a = amountField(o, 'amount', errors, 'Amount')
    if (a !== null) out.amount = a
  }
  if (o.recalculatePrice === true) out.recalculatePrice = true
  if ('courtId' in o) {
    const c = id(o, 'courtId', errors, 'Court', true)
    if (c) out.courtId = c
  }
  const win = timeWindow(o, errors, false)
  if (win) out.window = win
  if ('status' in o) {
    const s = oneOf(o, 'status', BOOKING_STATUSES, errors, 'Status', true)
    if (s) out.status = s
  }
  if ('cancelReason' in o) out.cancelReason = str(o, 'cancelReason', errors, { max: 500, label: 'Cancellation reason' })

  if (Object.keys(errors).length) throw new ValidationError(errors)
  return out
}

export type PaymentInput = { kind: 'PAYMENT' | 'REFUND'; method: PaymentMethodValue; amount: number; note: string | null }

export function validatePayment(body: unknown): PaymentInput {
  if (!body || typeof body !== 'object') throw new ValidationError({ body: 'Request body must be a JSON object' })
  const o = body as Obj
  const errors: Record<string, string> = {}
  const kind = oneOf(o, 'kind', ['PAYMENT', 'REFUND'] as const, errors, 'Kind') ?? 'PAYMENT'
  const method = oneOf(o, 'method', PAYMENT_METHODS, errors, 'Payment method', true)
  const amount = parseMoney(o.amount)
  if (amount === null || Number.isNaN(amount) || amount <= 0 || amount > 1_000_000) errors.amount = 'Amount must be greater than 0'
  const note = str(o, 'note', errors, { max: 500, label: 'Note' })
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return { kind, method: method!, amount: amount!, note }
}

export type BlockInput = { courtId: string; date: string; startMin: number; endMin: number; reason: string | null }

export function validateBlock(body: unknown): BlockInput & { venueId: string | null } {
  if (!body || typeof body !== 'object') throw new ValidationError({ body: 'Request body must be a JSON object' })
  const o = body as Obj
  const errors: Record<string, string> = {}
  const venueId = id(o, 'venueId', errors, 'Venue', false)
  const courtId = id(o, 'courtId', errors, 'Court', true)
  const win = timeWindow(o, errors, true)
  const reason = str(o, 'reason', errors, { max: 200, label: 'Reason' })
  if (Object.keys(errors).length) throw new ValidationError(errors)
  return { venueId, courtId: courtId!, date: win!.date, startMin: win!.startMin, endMin: win!.endMin, reason }
}

/** Derive the summary PaymentStatus from net money received vs. the booked amount. */
export function derivePaymentStatus(amount: number, paid: number, refunded: number): 'PENDING' | 'PAID' | 'REFUNDED' {
  const net = Math.round((paid - refunded) * 100) / 100
  if (refunded > 0 && net <= 0) return 'REFUNDED'
  if (net >= amount && (amount > 0 || paid > 0)) return 'PAID'
  if (amount === 0) return 'PAID'
  return 'PENDING'
}
