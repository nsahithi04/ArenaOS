import { describe, expect, it } from 'vitest'
import { grossPay, minutesWithin, salaryForPeriod } from '@/lib/staff/payroll'

describe('salaryForPeriod', () => {
  it('pays exactly one salary for a full calendar month', () => {
    expect(salaryForPeriod(3000, '2026-11-01', '2026-11-30')).toBe(3000)
    expect(salaryForPeriod(3000, '2026-02-01', '2026-02-28')).toBe(3000)
  })
  it('pro-rates part months by days', () => {
    expect(salaryForPeriod(3000, '2026-11-01', '2026-11-15')).toBe(1500) // 15/30
    expect(salaryForPeriod(3100, '2026-12-01', '2026-12-07')).toBe(700) // 7/31
  })
  it('splits periods that cross months', () => {
    // Nov 16–30 = 15/30 of Nov, Dec 1–15 = 15/31 of Dec
    expect(salaryForPeriod(3000, '2026-11-16', '2026-12-15')).toBe(Math.round((1500 + (3000 * 15) / 31) * 100) / 100)
    expect(salaryForPeriod(1000, '2026-01-01', '2026-12-31')).toBe(12000)
  })
  it('returns 0 for an empty range', () => {
    expect(salaryForPeriod(3000, '2026-11-10', '2026-11-09')).toBe(0)
  })
})

describe('minutesWithin', () => {
  const t = (s: string) => new Date(s)
  it('sums intervals clipped to the period', () => {
    const entries = [
      { start: t('2026-11-09T09:00:00Z'), end: t('2026-11-09T13:30:00Z') }, // 270
      { start: t('2026-11-08T22:00:00Z'), end: t('2026-11-09T02:00:00Z') }, // only 120 inside
      { start: t('2026-11-10T09:00:00Z'), end: t('2026-11-10T10:00:00Z') }, // outside
    ]
    expect(minutesWithin(entries, t('2026-11-09T00:00:00Z'), t('2026-11-10T00:00:00Z'))).toBe(390)
  })
  it('counts open entries up to now', () => {
    expect(minutesWithin([{ start: t('2026-11-09T09:00:00Z'), end: null }], t('2026-11-09T00:00:00Z'), t('2026-11-10T00:00:00Z'), t('2026-11-09T10:15:00Z'))).toBe(75)
  })
})

describe('grossPay', () => {
  it('hourly = hours worked × rate', () => {
    expect(grossPay('HOURLY', 18.5, 450, '2026-11-01', '2026-11-30')).toBe(138.75) // 7.5h
  })
  it('monthly ignores hours and pro-rates', () => {
    expect(grossPay('MONTHLY', 3000, 0, '2026-11-01', '2026-11-30')).toBe(3000)
  })
  it('is unknown when pay is not set', () => {
    expect(grossPay(null, null, 600, '2026-11-01', '2026-11-30')).toBeNull()
  })
})
