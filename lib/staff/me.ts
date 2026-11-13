import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { defaultVenueId } from '@/lib/booking/access'
import { jsonError } from '@/lib/booking/route-helpers'
import { selfMember } from './service'

/** The signed-in user's own staff record at their venue (any role). Owners have none. */
export async function requireSelfMember() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return jsonError(401, 'Unauthorized')
  const venueId = await defaultVenueId(prisma, userId)
  if (!venueId) return jsonError(404, 'No venue found for this account')
  const member = await selfMember(prisma, venueId, userId)
  if (!member) return jsonError(404, 'You are not on the staff of this venue')
  return { userId, venueId, member }
}
