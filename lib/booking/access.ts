// Server-side venue access. Permissions are always resolved from the database
// (venue ownership or an ACTIVE membership + role), never from client claims or
// the JWT role, so revoked staff lose access immediately.

import type { PrismaClient } from '@prisma/client'
import { can, NO_PERMISSIONS, OWNER_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

export type VenueAccess = { venueId: string; isOwner: boolean; permissions: VenuePermissions }

type Db = Pick<PrismaClient, 'venue' | 'venueMember'>

export async function getVenueAccess(db: Db, userId: string, venueId: string): Promise<VenueAccess | null> {
  const owned = await db.venue.findFirst({ where: { id: venueId, ownerId: userId }, select: { id: true } })
  if (owned) return { venueId, isOwner: true, permissions: OWNER_PERMISSIONS }

  const member = await db.venueMember.findFirst({
    where: { venueId, userId, status: 'active' },
    include: { role: true },
  })
  if (!member) return null
  return {
    venueId,
    isOwner: false,
    permissions: { ...NO_PERMISSIONS, ...((member.role?.permissions as Partial<VenuePermissions> | null) ?? {}) },
  }
}

/** The venue a user works with when the client does not specify one: first owned venue, else active membership. */
export async function defaultVenueId(db: Db, userId: string): Promise<string | null> {
  const owned = await db.venue.findFirst({ where: { ownerId: userId }, select: { id: true }, orderBy: { createdAt: 'asc' } })
  if (owned) return owned.id
  const member = await db.venueMember.findFirst({ where: { userId, status: 'active' }, select: { venueId: true } })
  return member?.venueId ?? null
}

export function hasPermission(access: VenueAccess, module: keyof VenuePermissions, level: 'view' | 'edit'): boolean {
  return access.isOwner || can(access.permissions, module, level)
}

/** Who may change past bookings: owners always; billing:edit holders (managers) within the correction window. */
export function lockActorOf(access: VenueAccess) {
  return { isOwner: access.isOwner, canCorrect: hasPermission(access, 'billing', 'edit') }
}
