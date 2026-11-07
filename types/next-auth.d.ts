import type { DefaultSession, DefaultJWT } from 'next-auth'
import type { VenuePermissions } from '@/lib/permissions'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      venueId: string | null
      /** True only if this user owns the venue (computed from Venue.ownerId, not the account type). */
      isOwner: boolean
      venuePermissions: VenuePermissions
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id?: string
    role?: string
    venueId?: string | null
    isOwner?: boolean
    venuePermissions?: VenuePermissions
    permissionsRefreshedAt?: number
  }
}
