import { describe, expect, it } from 'vitest'
import { formatDays, isMembershipActiveOn, membershipEndDate, membershipState, sessionDates } from '@/lib/club/schedule'

describe('membership periods', () => {
  it('ends the day before the same date next period', () => {
    expect(membershipEndDate('2026-01-15', 1)).toBe('2026-02-14')
    expect(membershipEndDate('2026-11-06', 12)).toBe('2027-11-05')
    expect(membershipEndDate('2026-11-01', 3)).toBe('2027-01-31')
  })
  it('handles month-end starts', () => {
    expect(membershipEndDate('2026-01-31', 1)).toBe('2026-02-28')
    expect(membershipEndDate('2028-01-31', 1)).toBe('2028-02-29') // leap year
    expect(membershipEndDate('2026-03-31', 1)).toBe('2026-04-30')
    expect(membershipEndDate('2026-12-31', 1)).toBe('2027-01-30')
  })
  it('is active only between start and end (inclusive) and not when cancelled', () => {
    const m = { status: 'ACTIVE', startDate: '2026-11-01', endDate: '2026-11-30' }
    expect(isMembershipActiveOn(m, '2026-11-01')).toBe(true)
    expect(isMembershipActiveOn(m, '2026-11-30')).toBe(true)
    expect(isMembershipActiveOn(m, '2026-12-01')).toBe(false)
    expect(isMembershipActiveOn({ ...m, status: 'CANCELLED' }, '2026-11-10')).toBe(false)
    expect(membershipState(m, '2026-10-31')).toBe('UPCOMING')
    expect(membershipState(m, '2026-12-01')).toBe('EXPIRED')
  })
})

describe('class sessions', () => {
  it('lists every matching weekday in the term', () => {
    // 2026-11-02 is a Monday
    expect(sessionDates('2026-11-02', '2026-11-15', ['MONDAY', 'WEDNESDAY'])).toEqual(['2026-11-02', '2026-11-04', '2026-11-09', '2026-11-11'])
    expect(sessionDates('2026-11-03', '2026-11-03', ['MONDAY'])).toEqual([])
    expect(sessionDates('2026-11-01', '2026-11-30', ['SATURDAY'])).toHaveLength(4)
  })
  it('formats days in week order', () => {
    expect(formatDays(['FRIDAY', 'MONDAY', 'WEDNESDAY'])).toBe('Mon, Wed, Fri')
  })
})
