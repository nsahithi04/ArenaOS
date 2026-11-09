// Single-elimination (knockout) bracket logic. Pure functions, no database.
//
// Layout: round 1 has size/2 matches (size = next power of two ≥ entrants).
// The winner of (round r, position p) plays in (round r+1, floor(p/2)),
// in slot A when p is even and slot B when p is odd.
//
// Seeding follows the standard pattern (1 v 16, 8 v 9, 5 v 12, 4 v 13, …) so the
// top seeds can only meet in the latest rounds. When the field isn't a power of
// two, the top seeds get byes (they advance to round 2 automatically).

export type BracketEntrant = { id: string; seed: number | null }

export type GeneratedMatch = {
  round: number
  position: number
  entrantAId: string | null
  entrantBId: string | null
  winnerId: string | null
  status: 'PENDING' | 'COMPLETED'
  score: string | null
}

export function bracketSize(n: number): number {
  let size = 2
  while (size < n) size *= 2
  return size
}

export function roundsFor(n: number): number {
  return Math.log2(bracketSize(n))
}

/** Seed numbers in bracket-line order, e.g. size 8 → [1, 8, 4, 5, 2, 7, 3, 6]. */
export function seedOrder(size: number): number[] {
  let order = [1, 2]
  while (order.length < size) {
    const n = order.length * 2
    order = order.flatMap((s) => [s, n + 1 - s])
  }
  return order
}

export function roundName(round: number, totalRounds: number): string {
  const fromEnd = totalRounds - round
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semi-finals'
  if (fromEnd === 2) return 'Quarter-finals'
  return `Round ${round}`
}

export function nextSlot(round: number, position: number): { round: number; position: number; slot: 'A' | 'B' } {
  return { round: round + 1, position: Math.floor(position / 2), slot: position % 2 === 0 ? 'A' : 'B' }
}

/**
 * Order entrants for the draw: seeded entrants first (by seed), then the rest in
 * the order given (registration order, or pre-shuffled by the caller for a random draw).
 */
export function drawOrder(entrants: BracketEntrant[]): BracketEntrant[] {
  const seeded = entrants.filter((e) => e.seed != null).sort((a, b) => a.seed! - b.seed!)
  const rest = entrants.filter((e) => e.seed == null)
  return [...seeded, ...rest]
}

/** Every match of the bracket, with byes already resolved and propagated into round 2. */
export function generateBracket(entrants: BracketEntrant[]): GeneratedMatch[] {
  if (entrants.length < 2) throw new Error('A knockout needs at least 2 entrants')
  const ordered = drawOrder(entrants)
  const size = bracketSize(ordered.length)
  const rounds = Math.log2(size)
  const lines = seedOrder(size).map((seed) => ordered[seed - 1]?.id ?? null) // null = bye

  const matches: GeneratedMatch[] = []
  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r
    for (let p = 0; p < count; p++) {
      matches.push({ round: r, position: p, entrantAId: null, entrantBId: null, winnerId: null, status: 'PENDING', score: null })
    }
  }
  const at = (r: number, p: number) => matches.find((m) => m.round === r && m.position === p)!

  for (let p = 0; p < size / 2; p++) {
    const m = at(1, p)
    m.entrantAId = lines[2 * p]
    m.entrantBId = lines[2 * p + 1]
    const solo = m.entrantAId && !m.entrantBId ? m.entrantAId : !m.entrantAId && m.entrantBId ? m.entrantBId : null
    if (solo) {
      m.winnerId = solo
      m.status = 'COMPLETED'
      m.score = 'Bye'
      if (rounds > 1) {
        const n = nextSlot(1, p)
        const next = at(n.round, n.position)
        if (n.slot === 'A') next.entrantAId = solo
        else next.entrantBId = solo
      }
    }
  }
  return matches
}

/** Fisher–Yates shuffle (pass a seeded RNG in tests). */
export function shuffle<T>(items: T[], rand: () => number = Math.random): T[] {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export type Placing = { place: number; label: string; entrantIds: string[] }

/**
 * Final placings from completed matches: 1 winner, 2 runner-up, 3 semi-final
 * losers (joint), 5 quarter-final losers (joint). Only places that are decided are returned.
 */
export function placings(matches: Pick<GeneratedMatch, 'round' | 'entrantAId' | 'entrantBId' | 'winnerId' | 'status' | 'score'>[], totalRounds: number): Placing[] {
  const out: Placing[] = []
  const final = matches.find((m) => m.round === totalRounds)
  const loser = (m: (typeof matches)[number]) => (m.winnerId === m.entrantAId ? m.entrantBId : m.entrantAId)
  if (final?.status === 'COMPLETED' && final.winnerId) {
    out.push({ place: 1, label: 'Winner', entrantIds: [final.winnerId] })
    const ru = loser(final)
    if (ru) out.push({ place: 2, label: 'Runner-up', entrantIds: [ru] })
  }
  const lostIn = (round: number) =>
    matches.filter((m) => m.round === round && m.status === 'COMPLETED' && m.score !== 'Bye').map(loser).filter((x): x is string => !!x)
  if (totalRounds >= 2) {
    const semi = lostIn(totalRounds - 1)
    if (semi.length) out.push({ place: 3, label: 'Semi-finalists', entrantIds: semi })
  }
  if (totalRounds >= 3) {
    const qf = lostIn(totalRounds - 2)
    if (qf.length) out.push({ place: 5, label: 'Quarter-finalists', entrantIds: qf })
  }
  return out
}
