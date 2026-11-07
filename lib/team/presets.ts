// Built-in team roles. Every venue gets these two; their permissions are fixed
// here (not editable in the UI) so "Manager" and "Employee" always mean the same thing.
//
//   Owner    – the user who created the venue. Full access, always (not a role).
//   Manager  – runs the venue day to day: dashboard & revenue, bookings, payments
//              and refunds, venue settings, and the team (employees only).
//   Employee – front desk: calendar and bookings (create, check in, take
//              payments). No dashboard, revenue, venue settings or team.

import type { PrismaClient, Prisma } from '@prisma/client'
import { NO_PERMISSIONS, type VenuePermissions } from '@/lib/permissions'

export type PresetKey = 'MANAGER' | 'EMPLOYEE'

export const PRESETS: Record<PresetKey, { name: string; color: string; description: string; permissions: VenuePermissions }> = {
  MANAGER: {
    name: 'Manager',
    color: '#7c3aed',
    description: 'Everything except deleting the venue or changing role definitions: dashboard and revenue, bookings, payments and refunds, venue settings, and managing employees.',
    permissions: { bookings: 'edit', venue: 'edit', reports: 'view', billing: 'edit', team: 'edit' },
  },
  EMPLOYEE: {
    name: 'Employee',
    color: '#2563eb',
    description: 'Calendar and bookings only: create bookings, check customers in and take payments. Cannot see the dashboard, revenue, venue settings or team.',
    permissions: { bookings: 'edit', venue: 'none', reports: 'none', billing: 'none', team: 'none' },
  },
}

export const PRESET_ORDER: PresetKey[] = ['MANAGER', 'EMPLOYEE']

type Db = Pick<PrismaClient, 'venueRole'> | Prisma.TransactionClient

/** Create the built-in roles for a venue if missing, and keep their permissions in sync with code. Idempotent and race-safe. */
export async function ensurePresetRoles(db: Db, venueId: string) {
  for (const key of PRESET_ORDER) {
    const p = PRESETS[key]
    await db.venueRole.upsert({
      where: { venueId_preset: { venueId, preset: key } },
      create: { venueId, preset: key, name: p.name, color: p.color, permissions: p.permissions },
      update: { name: p.name, color: p.color, permissions: p.permissions },
    })
  }
}

const MODULES = ['bookings', 'venue', 'reports', 'billing', 'team'] as const
const LEVELS = ['none', 'view', 'edit']

/** Validate a permissions object from a request body (for custom roles). */
export function parsePermissions(v: unknown): VenuePermissions | null {
  if (!v || typeof v !== 'object') return null
  const out = { ...NO_PERMISSIONS }
  for (const m of MODULES) {
    const level = (v as Record<string, unknown>)[m]
    if (level === undefined) continue
    if (typeof level !== 'string' || !LEVELS.includes(level)) return null
    out[m] = level as VenuePermissions[typeof m]
  }
  return out
}

/**
 * Team hierarchy: the owner can manage anyone. Other people with team:edit
 * (managers) can only manage members whose role does NOT grant team:edit,
 * i.e. they can invite/remove/re-assign employees but not other managers,
 * and cannot promote anyone to a role with team management.
 */
export function canManageRole(actor: { isOwner: boolean }, role: { permissions: unknown } | null): boolean {
  if (actor.isOwner) return true
  const perms = (role?.permissions ?? {}) as Partial<VenuePermissions>
  return perms.team !== 'edit'
}
