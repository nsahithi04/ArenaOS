// Venue-timezone helpers built on Intl (no extra dependency).
//
// Conventions used across the booking engine:
//   - "local date"  = 'YYYY-MM-DD' string in the venue's IANA timezone
//   - "minutes"     = minutes since local midnight (0..1440)
//   - instants      = JS Date (UTC), which is what Prisma stores

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const
export type DayName = (typeof DAY_NAMES)[number]

const fmtCache = new Map<string, Intl.DateTimeFormat>()
function partsFormatter(tz: string) {
  let f = fmtCache.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    fmtCache.set(tz, f)
  }
  return f
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export type ZonedParts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function zonedParts(date: Date, tz: string): ZonedParts {
  const out: Record<string, number> = {}
  for (const p of partsFormatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value)
  }
  return { year: out.year, month: out.month, day: out.day, hour: out.hour % 24, minute: out.minute, second: out.second }
}

/** Offset of `tz` from UTC at `date`, in minutes (e.g. America/Phoenix → -420). */
export function tzOffsetMinutes(date: Date, tz: string): number {
  const p = zonedParts(date, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000)
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLocalDate(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3]
}

/** Convert a venue-local wall-clock time to a UTC instant. Minutes may be 1440 (= next midnight). */
export function zonedToUtc(localDate: string, minutes: number, tz: string): Date {
  const m = DATE_RE.exec(localDate)
  if (!m) throw new Error(`Invalid local date: ${localDate}`)
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], 0, minutes)
  // Two passes handle DST transitions: guess with the offset at the wall time, then correct.
  let guess = wall - tzOffsetMinutes(new Date(wall), tz) * 60000
  guess = wall - tzOffsetMinutes(new Date(guess), tz) * 60000
  return new Date(guess)
}

export function localDateOf(date: Date, tz: string): string {
  const p = zonedParts(date, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function localMinutesOf(date: Date, tz: string): number {
  const p = zonedParts(date, tz)
  return p.hour * 60 + p.minute
}

export function addDays(localDate: string, n: number): string {
  const m = DATE_RE.exec(localDate)
  if (!m) throw new Error(`Invalid local date: ${localDate}`)
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + n))
  return d.toISOString().slice(0, 10)
}

export function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)
}

export function dayNameOf(localDate: string): DayName {
  return DAY_NAMES[new Date(`${localDate}T00:00:00Z`).getUTCDay()]
}

/** UTC [start, end) covering local dates from..to inclusive. */
export function localRangeToUtc(from: string, toInclusive: string, tz: string): { start: Date; end: Date } {
  return { start: zonedToUtc(from, 0, tz), end: zonedToUtc(addDays(toInclusive, 1), 0, tz) }
}

export function todayIn(tz: string, now = new Date()): string {
  return localDateOf(now, tz)
}

/** Monday-based week start. */
export function startOfWeek(localDate: string): string {
  const dow = new Date(`${localDate}T00:00:00Z`).getUTCDay() // 0 = Sunday
  return addDays(localDate, -((dow + 6) % 7))
}

export function startOfMonth(localDate: string): string {
  return `${localDate.slice(0, 8)}01`
}

export function endOfMonth(localDate: string): string {
  const [y, m] = localDate.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return d.toISOString().slice(0, 10)
}

/**
 * Parse a clock string to minutes since midnight.
 * Accepts the formats stored by onboarding ("6:00 AM", "10:30 PM", "12:00 AM")
 * and 24h "HH:mm". "24:00" / "12:00 AM" as a closing time is handled by callers.
 */
export function parseClock(s: string): number | null {
  const t = s.trim().toUpperCase()
  let m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t)
  if (m) {
    let h = +m[1]
    const min = +m[2]
    if (h < 1 || h > 12 || min > 59) return null
    if (m[3] === 'AM' && h === 12) h = 0
    if (m[3] === 'PM' && h !== 12) h += 12
    return h * 60 + min
  }
  m = /^(\d{1,2}):(\d{2})$/.exec(t)
  if (m) {
    const h = +m[1]
    const min = +m[2]
    if (h > 24 || min > 59 || (h === 24 && min !== 0)) return null
    return h * 60 + min
  }
  return null
}

/** Closing times of "12:00 AM" / "00:00" mean end of day. */
export function parseCloseClock(s: string): number | null {
  const v = parseClock(s)
  return v === 0 ? 1440 : v
}

export function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60) % 24
  const mm = String(min % 60).padStart(2, '0')
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${suffix}`
}

/** "HH:mm" (24h) for <input type="time">. */
export function toHHmm(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}
