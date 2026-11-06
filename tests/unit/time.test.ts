import { describe, expect, it } from 'vitest'
import {
  addDays, dayNameOf, endOfMonth, isLocalDate, localDateOf, localMinutesOf, localRangeToUtc, parseClock, parseCloseClock, startOfWeek,
  tzOffsetMinutes, zonedToUtc,
} from '@/lib/booking/time'

describe('venue timezone conversion', () => {
  it('converts Phoenix wall-clock (no DST) to UTC', () => {
    expect(zonedToUtc('2026-07-01', 9 * 60, 'America/Phoenix').toISOString()).toBe('2026-07-01T16:00:00.000Z')
    expect(zonedToUtc('2026-01-01', 9 * 60, 'America/Phoenix').toISOString()).toBe('2026-01-01T16:00:00.000Z')
  })

  it('handles DST in New York', () => {
    expect(zonedToUtc('2026-01-15', 18 * 60, 'America/New_York').toISOString()).toBe('2026-01-15T23:00:00.000Z')
    expect(zonedToUtc('2026-07-15', 18 * 60, 'America/New_York').toISOString()).toBe('2026-07-15T22:00:00.000Z')
    // Day after spring-forward (2026-03-08)
    expect(zonedToUtc('2026-03-09', 0, 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it('handles half-hour offsets (India)', () => {
    expect(zonedToUtc('2026-11-05', 18 * 60, 'Asia/Kolkata').toISOString()).toBe('2026-11-05T12:30:00.000Z')
    expect(tzOffsetMinutes(new Date('2026-11-05T00:00:00Z'), 'Asia/Kolkata')).toBe(330)
  })

  it('round-trips local date and minutes', () => {
    const d = zonedToUtc('2026-11-05', 23 * 60 + 30, 'Asia/Kolkata')
    expect(localDateOf(d, 'Asia/Kolkata')).toBe('2026-11-05')
    expect(localMinutesOf(d, 'Asia/Kolkata')).toBe(23 * 60 + 30)
    // Same instant is a different calendar day in UTC
    expect(localDateOf(d, 'UTC')).toBe('2026-11-05')
    expect(localDateOf(zonedToUtc('2026-11-05', 2 * 60, 'Asia/Kolkata'), 'UTC')).toBe('2026-11-04')
  })

  it('midnight end (1440) maps to next local midnight', () => {
    expect(zonedToUtc('2026-11-05', 1440, 'America/Phoenix').toISOString()).toBe('2026-11-06T07:00:00.000Z')
  })

  it('builds local day ranges', () => {
    const { start, end } = localRangeToUtc('2026-11-02', '2026-11-08', 'America/Phoenix')
    expect(start.toISOString()).toBe('2026-11-02T07:00:00.000Z')
    expect(end.toISOString()).toBe('2026-11-09T07:00:00.000Z')
  })
})

describe('date helpers', () => {
  it('validates dates', () => {
    expect(isLocalDate('2026-02-28')).toBe(true)
    expect(isLocalDate('2026-02-30')).toBe(false)
    expect(isLocalDate('2026-2-3')).toBe(false)
    expect(isLocalDate(undefined)).toBe(false)
  })
  it('weeks start on Monday', () => {
    expect(startOfWeek('2026-11-05')).toBe('2026-11-02') // Thursday → Monday
    expect(startOfWeek('2026-11-08')).toBe('2026-11-02') // Sunday → previous Monday
    expect(startOfWeek('2026-11-02')).toBe('2026-11-02')
  })
  it('month/day arithmetic', () => {
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(dayNameOf('2026-11-05')).toBe('Thursday')
  })
})

describe('clock parsing', () => {
  it('parses stored 12h strings and 24h strings', () => {
    expect(parseClock('6:00 AM')).toBe(360)
    expect(parseClock('12:00 PM')).toBe(720)
    expect(parseClock('12:30 AM')).toBe(30)
    expect(parseClock('10:00 PM')).toBe(1320)
    expect(parseClock('18:45')).toBe(1125)
    expect(parseClock('25:00')).toBeNull()
    expect(parseClock('13:00 PM')).toBeNull()
  })
  it('treats a midnight close as end of day', () => {
    expect(parseCloseClock('12:00 AM')).toBe(1440)
    expect(parseCloseClock('00:00')).toBe(1440)
    expect(parseCloseClock('10:00 PM')).toBe(1320)
  })
})
