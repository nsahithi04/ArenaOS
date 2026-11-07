'use client'

import { useSession } from 'next-auth/react'
import { can, OWNER_PERMISSIONS, NO_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

/**
 * UI-only permission helper (the server enforces the real checks).
 * `isOwner` comes from venue ownership in the session, not from the account
 * type set at sign-up, so invited staff never see owner-only screens.
 */
export function usePermissions() {
  const { data: session, status } = useSession()
  const isOwner = session?.user?.isOwner === true
  const permissions: VenuePermissions = isOwner ? OWNER_PERMISSIONS : session?.user?.venuePermissions ?? NO_PERMISSIONS

  return {
    permissions,
    isOwner,
    loading: status === 'loading',
    canView: (module: keyof VenuePermissions) => can(permissions, module, 'view'),
    canEdit: (module: keyof VenuePermissions) => can(permissions, module, 'edit'),
  }
}
