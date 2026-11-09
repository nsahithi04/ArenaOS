import { prisma } from '@/lib/db'
import type { VenuePermissions } from '@/lib/permissions'
import { isId, jsonError, requireEntityVenue } from '@/lib/booking/route-helpers'

export async function requireTournament(id: string, module: keyof VenuePermissions, level: 'view' | 'edit') {
  if (!isId(id)) return jsonError(404, 'Tournament not found')
  const t = await prisma.tournament.findUnique({ where: { id }, select: { venueId: true } })
  return requireEntityVenue(t?.venueId, module, level, 'Tournament not found')
}
