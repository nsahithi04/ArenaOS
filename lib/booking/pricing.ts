// Price calculation from the venue's PricingRule rows.
//
// PricingRule.priceUsd is an HOURLY rate in the venue currency. A booking is
// priced minute-by-minute so that a slot crossing a peak/off-peak boundary is
// pro-rated correctly. Rule precedence: court-specific > sport-specific > venue-wide.

import { dayNameOf, parseClock, parseCloseClock } from './time'

export type PricingRuleInput = {
  id: string
  label: string
  sportId: string | null
  courtId: string | null
  days: string // "Monday,Tuesday"
  startTime: string // "6:00 AM"
  endTime: string // "10:00 PM"
  priceUsd: number | string | { toString(): string }
}

export type PriceSegment = { ruleId: string; label: string; startMin: number; endMin: number; hourlyRate: number; amount: number }

export type PriceQuote = {
  /** Total in currency units, rounded to 2 decimals. */
  total: number
  segments: PriceSegment[]
  /** Minutes not covered by any rule (priced at 0). Non-zero means the price is incomplete. */
  uncoveredMinutes: number
}

type ParsedRule = { id: string; label: string; rank: number; days: Set<string>; start: number; end: number; rateCents: number }

function parseRules(rules: PricingRuleInput[], sportId: string | null, courtId: string | null): ParsedRule[] {
  const out: ParsedRule[] = []
  for (const r of rules) {
    let rank: number
    if (r.courtId) {
      if (r.courtId !== courtId) continue
      rank = 3
    } else if (r.sportId) {
      if (r.sportId !== sportId) continue
      rank = 2
    } else {
      rank = 1
    }
    const start = parseClock(r.startTime)
    const end = parseCloseClock(r.endTime)
    const rate = Number(r.priceUsd.toString())
    if (start == null || end == null || !Number.isFinite(rate) || rate < 0) continue
    out.push({
      id: r.id,
      label: r.label,
      rank,
      days: new Set(r.days.split(',').map((d) => d.trim()).filter(Boolean)),
      start,
      end,
      rateCents: Math.round(rate * 100),
    })
  }
  // Most specific first; stable for equal rank.
  return out.sort((a, b) => b.rank - a.rank)
}

function covers(rule: ParsedRule, minute: number): boolean {
  if (rule.end > rule.start) return minute >= rule.start && minute < rule.end
  if (rule.end < rule.start) return minute >= rule.start || minute < rule.end // overnight window
  return false
}

export function quotePrice(opts: {
  rules: PricingRuleInput[]
  sportId: string | null
  courtId: string | null
  localDate: string
  startMin: number
  endMin: number
}): PriceQuote {
  const { localDate, startMin, endMin } = opts
  if (!(endMin > startMin)) return { total: 0, segments: [], uncoveredMinutes: 0 }

  const day = dayNameOf(localDate)
  const rules = parseRules(opts.rules, opts.sportId, opts.courtId).filter((r) => r.days.has(day))

  const segments: Array<{ rule: ParsedRule | null; startMin: number; endMin: number }> = []
  for (let m = startMin; m < endMin; m++) {
    const rule = rules.find((r) => covers(r, m)) ?? null
    const last = segments[segments.length - 1]
    if (last && last.rule === rule) last.endMin = m + 1
    else segments.push({ rule, startMin: m, endMin: m + 1 })
  }

  let totalCentsTimes60 = 0
  let uncovered = 0
  const priced: PriceSegment[] = []
  for (const s of segments) {
    const minutes = s.endMin - s.startMin
    if (!s.rule) {
      uncovered += minutes
      continue
    }
    totalCentsTimes60 += s.rule.rateCents * minutes
    priced.push({
      ruleId: s.rule.id,
      label: s.rule.label,
      startMin: s.startMin,
      endMin: s.endMin,
      hourlyRate: s.rule.rateCents / 100,
      amount: Math.round((s.rule.rateCents * minutes) / 60) / 100,
    })
  }

  return { total: Math.round(totalCentsTimes60 / 60) / 100, segments: priced, uncoveredMinutes: uncovered }
}
