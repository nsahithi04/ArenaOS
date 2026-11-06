import type { NextAuthConfig } from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { NO_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

// Lightweight config — no Prisma, safe for Edge (middleware)
export const authConfig = {
  session: { strategy: 'jwt' as const },
  pages: { signIn: '/login' },
  providers: [Credentials({})],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id   = user.id
        token.role = (user as { role?: string }).role ?? 'PLAYER'
      }
      // No DB queries — venueId / venuePermissions already encoded in the JWT
      // by the full auth.ts on sign-in
      return token
    },
    session({ session, token }) {
      session.user.id               = (token.id   ?? '') as string
      session.user.role             = (token.role ?? 'PLAYER') as string
      session.user.venueId          = (token.venueId ?? null) as string | null
      session.user.venuePermissions = (token.venuePermissions ?? NO_PERMISSIONS) as VenuePermissions
      return session
    },
  },
} satisfies NextAuthConfig
