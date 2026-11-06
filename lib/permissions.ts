export type PermLevel = 'none' | 'view' | 'edit'

export type VenuePermissions = {
  bookings: PermLevel
  venue:    PermLevel
  reports:  PermLevel
  billing:  PermLevel
  team:     PermLevel
}

export const OWNER_PERMISSIONS: VenuePermissions = {
  bookings: 'edit',
  venue:    'edit',
  reports:  'edit',
  billing:  'edit',
  team:     'edit',
}

export const NO_PERMISSIONS: VenuePermissions = {
  bookings: 'none',
  venue:    'none',
  reports:  'none',
  billing:  'none',
  team:     'none',
}

export function can(permissions: VenuePermissions, module: keyof VenuePermissions, level: 'view' | 'edit'): boolean {
  const p = permissions[module]
  if (level === 'view') return p === 'view' || p === 'edit'
  return p === 'edit'
}
