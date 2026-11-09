import { describe, expect, it } from 'vitest'
import { bracketSize, generateBracket, nextSlot, placings, roundName, roundsFor, seedOrder, shuffle } from '@/lib/tournaments/bracket'

const players = (n: number, seeded = 0) => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, seed: i < seeded ? i + 1 : null }))

describe('bracket shape', () => {
  it('sizes to the next power of two', () => {
    expect([2, 3, 4, 5, 8, 9, 16, 17].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16, 16, 32])
    expect(roundsFor(6)).toBe(3)
  })
  it('uses the standard seeding pattern so top seeds meet last', () => {
    expect(seedOrder(4)).toEqual([1, 4, 2, 3])
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    // 1 and 2 are in opposite halves
    const o = seedOrder(16)
    expect(o.indexOf(1) < 8).toBe(true)
    expect(o.indexOf(2) >= 8).toBe(true)
  })
  it('names rounds from the end', () => {
    expect([1, 2, 3, 4].map((r) => roundName(r, 4))).toEqual(['Round 1', 'Quarter-finals', 'Semi-finals', 'Final'])
    expect(roundName(1, 1)).toBe('Final')
  })
  it('winners move to the right slot of the next round', () => {
    expect(nextSlot(1, 0)).toEqual({ round: 2, position: 0, slot: 'A' })
    expect(nextSlot(1, 1)).toEqual({ round: 2, position: 0, slot: 'B' })
    expect(nextSlot(2, 3)).toEqual({ round: 3, position: 1, slot: 'B' })
  })
})

describe('generateBracket', () => {
  it('builds every match for a full 8-player draw with no byes', () => {
    const m = generateBracket(players(8, 8))
    expect(m).toHaveLength(7) // 4 + 2 + 1
    const r1 = m.filter((x) => x.round === 1)
    expect(r1.map((x) => [x.entrantAId, x.entrantBId])).toEqual([['p1', 'p8'], ['p4', 'p5'], ['p2', 'p7'], ['p3', 'p6']])
    expect(m.every((x) => x.status === 'PENDING')).toBe(true)
  })

  it('gives byes to the top seeds and advances them', () => {
    const m = generateBracket(players(6, 2)) // size 8 → 2 byes
    const byes = m.filter((x) => x.score === 'Bye')
    expect(byes.map((b) => b.winnerId).sort()).toEqual(['p1', 'p2'])
    const r2 = m.filter((x) => x.round === 2)
    expect(r2[0].entrantAId).toBe('p1') // seed 1 waits in the semi
    expect(r2[1].entrantAId).toBe('p2')
    // No match ever has two byes
    expect(m.filter((x) => x.round === 1 && !x.entrantAId && !x.entrantBId)).toHaveLength(0)
  })

  it('handles the smallest and odd fields', () => {
    expect(generateBracket(players(2))).toEqual([{ round: 1, position: 0, entrantAId: 'p1', entrantBId: 'p2', winnerId: null, status: 'PENDING', score: null }])
    const three = generateBracket(players(3))
    expect(three).toHaveLength(3)
    expect(three.filter((x) => x.score === 'Bye')).toHaveLength(1)
    for (const n of [5, 7, 9, 12, 13]) {
      const m = generateBracket(players(n))
      const ids = new Set(m.filter((x) => x.round === 1).flatMap((x) => [x.entrantAId, x.entrantBId]).filter(Boolean))
      expect(ids.size).toBe(n) // everyone appears exactly once in round 1
    }
  })

  it('places seeded entrants first and unseeded in the given order', () => {
    const m = generateBracket([{ id: 'x', seed: null }, { id: 'y', seed: null }, { id: 'top', seed: 1 }, { id: 'z', seed: null }])
    expect(m[0].entrantAId).toBe('top')
  })

  it('refuses fewer than two entrants', () => {
    expect(() => generateBracket(players(1))).toThrow('at least 2')
  })

  it('shuffles deterministically with a seeded RNG', () => {
    let s = 1
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647)
    const a = shuffle([1, 2, 3, 4, 5], rand)
    expect(a).toHaveLength(5)
    expect([...a].sort()).toEqual([1, 2, 3, 4, 5])
  })
})

describe('placings', () => {
  it('ranks winner, runner-up and semi-finalists', () => {
    const m = generateBracket(players(4, 4)) // p1 v p4, p2 v p3
    const done = m.map((x) => ({ ...x }))
    done[0] = { ...done[0], winnerId: 'p1', status: 'COMPLETED', score: '21-15' }
    done[1] = { ...done[1], winnerId: 'p3', status: 'COMPLETED', score: '21-19' }
    done[2] = { ...done[2], entrantAId: 'p1', entrantBId: 'p3', winnerId: 'p3', status: 'COMPLETED', score: '21-18' }
    expect(placings(done, 2)).toEqual([
      { place: 1, label: 'Winner', entrantIds: ['p3'] },
      { place: 2, label: 'Runner-up', entrantIds: ['p1'] },
      { place: 3, label: 'Semi-finalists', entrantIds: ['p4', 'p2'] },
    ])
  })
  it('ignores byes when listing losers', () => {
    const m = generateBracket(players(3))
    expect(placings(m, 2)).toEqual([])
  })
})
