import { describe, expect, it } from 'vitest'
import { quotePrice, type PricingRuleInput } from '@/lib/booking/pricing'

const ALL = 'Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday'
const rule = (o: Partial<PricingRuleInput> & { id: string }): PricingRuleInput => ({
  label: o.id, sportId: 'sport1', courtId: null, days: ALL, startTime: '6:00 AM', endTime: '10:00 PM', priceUsd: '20', ...o,
})

// 2026-11-05 is a Thursday, 2026-11-07 a Saturday
describe('quotePrice', () => {
  it('charges the hourly rate pro-rata', () => {
    const q = quotePrice({ rules: [rule({ id: 'std' })], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 690 })
    expect(q.total).toBe(30) // 1.5h × 20
    expect(q.uncoveredMinutes).toBe(0)
  })

  it('splits a slot that crosses into peak pricing', () => {
    const rules = [rule({ id: 'off', endTime: '5:00 PM', priceUsd: 20 }), rule({ id: 'peak', startTime: '5:00 PM', priceUsd: '30' })]
    const q = quotePrice({ rules, sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 16 * 60, endMin: 18 * 60 })
    expect(q.total).toBe(50)
    expect(q.segments.map((s) => [s.label, s.startMin, s.endMin, s.amount])).toEqual([
      ['off', 960, 1020, 20],
      ['peak', 1020, 1080, 30],
    ])
  })

  it('uses day-specific rules', () => {
    const rules = [rule({ id: 'weekday', days: 'Monday,Tuesday,Wednesday,Thursday,Friday', priceUsd: 15 }), rule({ id: 'weekend', days: 'Saturday,Sunday', priceUsd: 25 })]
    expect(quotePrice({ rules, sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 660 }).total).toBe(15)
    expect(quotePrice({ rules, sportId: 'sport1', courtId: 'c1', localDate: '2026-11-07', startMin: 600, endMin: 660 }).total).toBe(25)
  })

  it('prefers court-specific over sport-specific over venue-wide rules', () => {
    const rules = [
      rule({ id: 'venue', sportId: null, priceUsd: 10 }),
      rule({ id: 'sport', priceUsd: 20 }),
      rule({ id: 'court', courtId: 'c2', priceUsd: 40 }),
    ]
    expect(quotePrice({ rules, sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 660 }).total).toBe(20)
    expect(quotePrice({ rules, sportId: 'sport1', courtId: 'c2', localDate: '2026-11-05', startMin: 600, endMin: 660 }).total).toBe(40)
    expect(quotePrice({ rules, sportId: 'other', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 660 }).total).toBe(10)
  })

  it('reports minutes no rule covers', () => {
    const q = quotePrice({ rules: [rule({ id: 'std' })], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 21 * 60, endMin: 23 * 60 })
    expect(q.total).toBe(20)
    expect(q.uncoveredMinutes).toBe(60)
  })

  it('ignores rules for other sports', () => {
    const q = quotePrice({ rules: [rule({ id: 'x', sportId: 'tennis' })], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 660 })
    expect(q.total).toBe(0)
    expect(q.uncoveredMinutes).toBe(60)
  })

  it('supports overnight windows and midnight close', () => {
    const night = rule({ id: 'night', startTime: '10:00 PM', endTime: '2:00 AM', priceUsd: 12 })
    expect(quotePrice({ rules: [night], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 23 * 60, endMin: 1440 }).total).toBe(12)
    const lateClose = rule({ id: 'late', startTime: '6:00 PM', endTime: '12:00 AM', priceUsd: 30 })
    expect(quotePrice({ rules: [lateClose], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 23 * 60, endMin: 1440 }).uncoveredMinutes).toBe(0)
  })

  it('rounds to cents without drift', () => {
    const q = quotePrice({ rules: [rule({ id: 'odd', priceUsd: '17.99' })], sportId: 'sport1', courtId: 'c1', localDate: '2026-11-05', startMin: 600, endMin: 645 })
    expect(q.total).toBe(13.49) // 17.99 × 0.75 = 13.4925
  })
})
