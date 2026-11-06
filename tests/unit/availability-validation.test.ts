import { describe, expect, it } from 'vitest'
import { checkOperatingHours, isBlockingStatus, openWindow, overlaps, type HoursRow } from '@/lib/booking/availability'
import { derivePaymentStatus, validateCreateBooking, validatePayment, validateUpdateBooking, ValidationError } from '@/lib/booking/validation'
import { canTransition } from '@/lib/booking/service'

describe('overlaps (half-open intervals)', () => {
  it('detects overlap and allows back-to-back slots', () => {
    expect(overlaps(600, 660, 630, 690)).toBe(true)
    expect(overlaps(600, 660, 660, 720)).toBe(false) // touching
    expect(overlaps(600, 720, 630, 660)).toBe(true) // contained
    expect(overlaps(new Date('2026-01-01T10:00Z'), new Date('2026-01-01T11:00Z'), new Date('2026-01-01T11:00Z'), new Date('2026-01-01T12:00Z'))).toBe(false)
  })
  it('cancelled bookings do not block', () => {
    expect(isBlockingStatus('CANCELLED')).toBe(false)
    expect(isBlockingStatus('CONFIRMED')).toBe(true)
    expect(isBlockingStatus('PENDING')).toBe(true)
  })
})

describe('operating hours', () => {
  const hours: HoursRow[] = [
    { sportId: 's1', day: 'THURSDAY', openTime: '8:00 AM', closeTime: '10:00 PM', isClosed: false },
    { sportId: 's1', day: 'WEDNESDAY', openTime: '8:00 AM', closeTime: '10:00 PM', isClosed: true },
    { sportId: null, day: 'THURSDAY', openTime: '6:00 AM', closeTime: '12:00 AM', isClosed: false },
  ]
  it('accepts slots inside sport hours', () => {
    expect(checkOperatingHours(hours, 's1', '2026-11-05', 8 * 60, 9 * 60).ok).toBe(true)
    expect(checkOperatingHours(hours, 's1', '2026-11-05', 21 * 60, 22 * 60).ok).toBe(true)
  })
  it('rejects slots outside hours or on closed days', () => {
    expect(checkOperatingHours(hours, 's1', '2026-11-05', 7 * 60, 9 * 60)).toMatchObject({ ok: false, reason: 'outside-hours' })
    expect(checkOperatingHours(hours, 's1', '2026-11-04', 10 * 60, 11 * 60)).toMatchObject({ ok: false, reason: 'closed' })
  })
  it('falls back to venue-wide hours, then allows when nothing is configured', () => {
    expect(checkOperatingHours(hours, 'other', '2026-11-05', 23 * 60, 1440).ok).toBe(true)
    expect(checkOperatingHours(hours, 'other', '2026-11-06', 3 * 60, 4 * 60)).toMatchObject({ ok: true, reason: 'no-hours-configured' })
  })
  it('computes open windows', () => {
    expect(openWindow(hours, 's1', '2026-11-05')).toEqual({ open: 480, close: 1320 })
    expect(openWindow(hours, 's1', '2026-11-04')).toEqual({ open: 0, close: 0 })
    expect(openWindow(hours, 's1', '2026-11-06')).toBeNull()
  })
})

describe('booking validation', () => {
  const valid = { courtId: 'court1', customer: '  Asha  ', source: 'WALK_IN', date: '2026-11-05', start: '18:00', durationMinutes: 90 }

  it('normalises a valid create payload', () => {
    const v = validateCreateBooking({ ...valid, email: 'A@B.CO', phone: '+1 (555) 123-4567' })
    expect(v).toMatchObject({ customer: 'Asha', startMin: 1080, endMin: 1170, source: 'WALK_IN', status: 'CONFIRMED', email: 'a@b.co', amount: null })
  })

  it('collects field errors', () => {
    try {
      validateCreateBooking({ courtId: 'c', source: 'FAX', date: '2026-13-01', start: '9am', end: '10:00', email: 'nope' })
      throw new Error('expected failure')
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError)
      expect(Object.keys((e as ValidationError).fields).sort()).toEqual(['customer', 'date', 'email', 'source', 'start'].sort())
    }
  })

  it('rejects bad windows', () => {
    expect(() => validateCreateBooking({ ...valid, durationMinutes: undefined, end: '17:00' })).toThrow('End time must be after start time')
    expect(() => validateCreateBooking({ ...valid, start: '23:30', durationMinutes: 60 })).toThrow('past midnight')
    expect(() => validateCreateBooking({ ...valid, durationMinutes: 10 })).toThrow('Minimum booking')
    expect(() => validateCreateBooking({ ...valid, start: '18:03' })).toThrow('5-minute')
    expect(validateCreateBooking({ ...valid, start: '23:00', durationMinutes: undefined, end: '00:00' }).endMin).toBe(1440)
  })

  it('rejects negative or absurd amounts and bad ids', () => {
    expect(() => validateCreateBooking({ ...valid, amount: -5 })).toThrow('Amount')
    expect(() => validateCreateBooking({ ...valid, courtId: "x' OR 1=1" })).toThrow('Court is invalid')
  })

  it('validates updates and payments', () => {
    expect(validateUpdateBooking({ status: 'CANCELLED', cancelReason: 'rain' })).toMatchObject({ status: 'CANCELLED', cancelReason: 'rain' })
    expect(() => validateUpdateBooking({ status: 'DONE' })).toThrow('Status')
    expect(validatePayment({ method: 'UPI', amount: '12.505' })).toMatchObject({ kind: 'PAYMENT', amount: 12.51 })
    expect(() => validatePayment({ method: 'UPI', amount: 0 })).toThrow('greater than 0')
  })
})

describe('payment status derivation', () => {
  it('derives from net money received', () => {
    expect(derivePaymentStatus(50, 0, 0)).toBe('PENDING')
    expect(derivePaymentStatus(50, 20, 0)).toBe('PENDING')
    expect(derivePaymentStatus(50, 50, 0)).toBe('PAID')
    expect(derivePaymentStatus(50, 50, 50)).toBe('REFUNDED')
    expect(derivePaymentStatus(50, 50, 10)).toBe('PENDING')
    expect(derivePaymentStatus(0, 0, 0)).toBe('PAID')
  })
})

describe('status transitions', () => {
  it('allows the booking lifecycle and blocks nonsense', () => {
    expect(canTransition('CONFIRMED', 'CHECKED_IN')).toBe(true)
    expect(canTransition('CHECKED_IN', 'COMPLETED')).toBe(true)
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(true)
    expect(canTransition('COMPLETED', 'CANCELLED')).toBe(false)
    expect(canTransition('CANCELLED', 'COMPLETED')).toBe(false)
  })
})
