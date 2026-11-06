import type { DefaultSession, DefaultJWT } from 'next-auth'
import type { VenuePermissions } from '@/lib/permissions'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: string
      venueId: string | null
      venuePermissions: VenuePermissions
    } & DefaultSession['user']
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id?: string
    role?: string
    venueId?: string | null
    venuePermissions?: VenuePermissions
    permissionsRefreshedAt?: number
  }
}
