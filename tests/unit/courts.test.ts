import { describe, expect, it } from 'vitest'
import { courtLabel, courtNameProblems } from '@/lib/booking/courts'
import { describeConflicts, freeSegments } from '@/lib/club/service'

const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 13, h, m))

describe('court names', () => {
  it('labels a court with its sport', () => {
    expect(courtLabel('Court 1', 'Pickleball')).toBe('Court 1 · Pickleball')
    expect(courtLabel('Court 1', null)).toBe('Court 1')
  })

  it('allows the same name across sports but not within one', () => {
    const sport = (id: string | null) => (id === 'p' ? 'Pickleball' : 'Badminton')
    expect(courtNameProblems([{ name: 'Court 1', sportId: 'p' }, { name: 'Court 1', sportId: 'b' }], sport)).toEqual([])
    expect(courtNameProblems([{ name: 'Court 1', sportId: 'p' }, { name: ' court  1 ', sportId: 'p' }], sport)).toEqual([
      { index: 1, message: 'Two Pickleball courts are named "court  1". Use a different name for each court of the same sport.' },
    ])
    expect(courtNameProblems([{ name: '  ', sportId: 'p' }])).toEqual([{ index: 0, message: 'Court name is required.' }])
  })
})

describe('reserving around busy time', () => {
  it('returns the free pieces of a window', () => {
    const free = freeSegments(t(9), t(18), [{ start: t(17), end: t(18) }, { start: t(10), end: t(11) }])
    expect(free.map((f) => [f.start.getUTCHours(), f.end.getUTCHours()])).toEqual([[9, 10], [11, 17]])
  })

  it('handles overlapping busy times and drops slivers under 15 minutes', () => {
    const free = freeSegments(t(9), t(12), [{ start: t(8), end: t(9, 10) }, { start: t(10), end: t(11) }, { start: t(10, 30), end: t(11, 50) }])
    expect(free.map((f) => [f.start.toISOString().slice(11, 16), f.end.toISOString().slice(11, 16)])).toEqual([['09:10', '10:00']])
  })

  it('returns nothing when the window is fully taken', () => {
    expect(freeSegments(t(9), t(10), [{ start: t(8), end: t(11) }])).toEqual([])
  })

  it('describes clashes with court, day, time and what is in the way', () => {
    const c = (i: number) => ({ date: '2026-11-13', courtId: 'x', courtName: `Court ${i} · Pickleball`, what: 'Class: junior', time: '5:00 PM – 6:00 PM' })
    expect(describeConflicts([c(1)])).toBe('Court 1 · Pickleball on Fri, Nov 13, 5:00 PM – 6:00 PM (Class: junior)')
    expect(describeConflicts([c(1), c(2), c(3), c(4), c(5)])).toMatch(/; and 2 more$/)
  })
})
