'use client'

import { useSession } from 'next-auth/react'
import { can, OWNER_PERMISSIONS, NO_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

export function usePermissions() {
  const { data: session } = useSession()
  const permissions: VenuePermissions = session?.user?.venuePermissions ?? NO_PERMISSIONS
  const isOwner = session?.user?.role === 'VENUE_OWNER'

  // Owners always get full access regardless of what's in the token
  const effective = isOwner ? OWNER_PERMISSIONS : permissions

  return {
    permissions: effective,
    isOwner,
    canView:  (module: keyof VenuePermissions) => can(effective, module, 'view'),
    canEdit:  (module: keyof VenuePermissions) => can(effective, module, 'edit'),
  }
}
