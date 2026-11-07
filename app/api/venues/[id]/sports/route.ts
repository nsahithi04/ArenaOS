import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'

// Saves the venue's sport list (needs venue:edit).
//
// Sports are matched by name and kept, not deleted and recreated: operating
// hours cascade-delete with their sport, and courts, pricing rules and bookings
// link to it. Only sports actually removed in the UI are deleted.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'venue', 'edit')
  if (ctx instanceof Response) return ctx

  try {
    const { sports } = (await readJson(req)) as { sports?: { name?: unknown; emoji?: unknown }[] }
    if (!Array.isArray(sports)) return jsonError(400, 'sports must be an array')
    const wanted = new Map<string, { name: string; emoji: string | null }>()
    for (const s of sports) {
      const name = typeof s?.name === 'string' ? s.name.trim() : ''
      if (!name || name.length > 60) return jsonError(400, 'Each sport needs a name (max 60 characters)')
      wanted.set(name.toLowerCase(), { name, emoji: typeof s.emoji === 'string' ? s.emoji.slice(0, 8) : null })
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.sport.findMany({ where: { venueId: id } })
      const byKey = new Map(existing.map((s) => [s.name.toLowerCase(), s]))
      for (const [key, s] of wanted) {
        const cur = byKey.get(key)
        if (cur) await tx.sport.update({ where: { id: cur.id }, data: { name: s.name, emoji: s.emoji ?? cur.emoji } })
        else await tx.sport.create({ data: { venueId: id, name: s.name, emoji: s.emoji } })
      }
      const removed = existing.filter((s) => !wanted.has(s.name.toLowerCase())).map((s) => s.id)
      if (removed.length) await tx.sport.deleteMany({ where: { id: { in: removed } } })
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'venues/sports POST')
  }
}
