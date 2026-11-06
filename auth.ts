import NextAuth from 'next-auth'
import { PrismaAdapter } from '@auth/prisma-adapter'
import Credentials from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { authConfig } from './auth.config'
import { OWNER_PERMISSIONS, NO_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(prisma),
  providers: [
    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null
        const user = await prisma.user.findUnique({ where: { email: credentials.email as string } })
        if (!user?.password) return null
        const valid = await bcrypt.compare(credentials.password as string, user.password)
        if (!valid) return null
        return user
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id   = user.id
        token.role = (user as { role?: string }).role ?? 'PLAYER'
        token.permissionsRefreshedAt = 0 // force refresh on first sign-in
      }

      // Client called useSession().update() — force an immediate refresh so
      // newly-linked members see their permissions without waiting for TTL
      if (trigger === 'update') {
        token.permissionsRefreshedAt = 0
      }

      // Refresh permissions at most once every 60 seconds to avoid
      // a DB round-trip on every single API call
      const PERMISSIONS_TTL = 60_000
      const now = Date.now()
      const lastRefresh = (token.permissionsRefreshedAt ?? 0) as number

      if (token.id && now - lastRefresh > PERMISSIONS_TTL) {
        const userId = token.id as string
        const ownedVenue = await prisma.venue.findFirst({ where: { ownerId: userId } })
        if (ownedVenue) {
          token.venueId          = ownedVenue.id
          token.venuePermissions = OWNER_PERMISSIONS
        } else {
          const membership = await prisma.venueMember.findFirst({
            where: { userId },
            include: { role: true },
          })
          if (membership) {
            token.venueId = membership.venueId
            // Merge with NO_PERMISSIONS so missing keys in stored JSON
            // default to 'none' rather than being undefined at runtime
            token.venuePermissions = {
              ...NO_PERMISSIONS,
              ...(membership.role?.permissions as Partial<VenuePermissions> ?? {}),
            }
          } else {
            token.venueId          = null
            token.venuePermissions = NO_PERMISSIONS
          }
        }
        token.permissionsRefreshedAt = now
      }

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
})
