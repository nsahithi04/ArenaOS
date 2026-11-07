import { describe, expect, it } from 'vitest'
import { canChangeBookingOn, canCheckInOn, correctionWindowDays, lockMessage, MANAGER_CORRECTION_DAYS } from '@/lib/booking/locks'

const OWNER = { isOwner: true, canCorrect: true }
const MANAGER = { isOwner: false, canCorrect: true }
const EMPLOYEE = { isOwner: false, canCorrect: false }
const TODAY = '2026-11-06'

describe('booking locks', () => {
  it('everyone can change today and future bookings', () => {
    for (const a of [OWNER, MANAGER, EMPLOYEE]) {
      expect(canChangeBookingOn(a, TODAY, TODAY)).toBe(true)
      expect(canChangeBookingOn(a, '2026-12-01', TODAY)).toBe(true)
    }
  })

  it('employees are locked out of anything before today', () => {
    expect(canChangeBookingOn(EMPLOYEE, '2026-11-05', TODAY)).toBe(false)
    expect(correctionWindowDays(EMPLOYEE)).toBe(0)
  })

  it(`managers get a ${MANAGER_CORRECTION_DAYS}-day correction window`, () => {
    expect(canChangeBookingOn(MANAGER, '2026-11-05', TODAY)).toBe(true) // yesterday
    expect(canChangeBookingOn(MANAGER, '2026-10-30', TODAY)).toBe(true) // exactly 7 days
    expect(canChangeBookingOn(MANAGER, '2026-10-29', TODAY)).toBe(false) // 8 days
    expect(canChangeBookingOn(MANAGER, '2026-06-01', TODAY)).toBe(false)
  })

  it('owners can change any date', () => {
    expect(canChangeBookingOn(OWNER, '2026-06-01', TODAY)).toBe(true)
    expect(canChangeBookingOn(OWNER, '2020-01-01', TODAY)).toBe(true)
  })

  it('check-in only on the booking day', () => {
    expect(canCheckInOn(TODAY, TODAY)).toBe(true)
    expect(canCheckInOn('2026-11-05', TODAY)).toBe(false)
    expect(canCheckInOn('2026-11-07', TODAY)).toBe(false)
  })

  it('explains the lock in terms of who can help', () => {
    expect(lockMessage(MANAGER)).toContain('Only the owner')
    expect(lockMessage(EMPLOYEE)).toContain('manager or the owner')
  })
})
