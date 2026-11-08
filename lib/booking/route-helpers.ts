// Shared plumbing for booking API route handlers: auth, venue resolution,
// permission checks and consistent error responses.

import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import type { VenuePermissions } from '@/lib/permissions'
import { defaultVenueId, getVenueAccess, hasPermission, type VenueAccess } from './access'
import { ServiceError } from './errors'
import { ValidationError } from './validation'

export type Ctx = { userId: string; access: VenueAccess }

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status })
}

/**
 * Authenticate and authorise a request against a venue.
 * `venueId` comes from the request; when absent the user's default venue is used.
 * Returns a Response on failure, so callers do: `const ctx = await requireVenue(...); if (ctx instanceof Response) return ctx`.
 */
export async function requireVenue(
  venueId: string | null | undefined,
  module: keyof VenuePermissions,
  level: 'view' | 'edit',
): Promise<Ctx | Response> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return jsonError(401, 'Unauthorized')

  const id = venueId || (await defaultVenueId(prisma, userId))
  if (!id) return jsonError(404, 'No venue found for this account')
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) return jsonError(400, 'Invalid venueId')

  const access = await getVenueAccess(prisma, userId, id)
  // Same response for "doesn't exist" and "not yours" so venue IDs can't be probed.
  if (!access) return jsonError(403, 'Forbidden')
  if (!hasPermission(access, module, level)) {
    return jsonError(403, `You don't have permission to ${level} ${module}`)
  }
  return { userId, access }
}

export function handleError(err: unknown, tag: string) {
  if (err instanceof ValidationError) return jsonError(400, err.message, { fields: err.fields })
  if (err instanceof ServiceError) return jsonError(err.status, err.message, { code: err.code, ...(err.details && { details: err.details }) })
  if (err instanceof SyntaxError) return jsonError(400, 'Request body must be valid JSON')
  console.error(`[${tag}]`, err)
  return jsonError(500, 'Something went wrong. Please try again.')
}

export async function readJson(req: Request): Promise<unknown> {
  const text = await req.text()
  if (text.length > 20_000) throw new ValidationError({ body: 'Request body too large' })
  return text ? JSON.parse(text) : {}
}

/**
 * Authorise against the venue that owns an entity (looked up by the caller).
 * Missing entities and other tenants' entities both answer 404; members lacking
 * the permission get a 403 explaining why.
 */
export async function requireEntityVenue(
  entityVenueId: string | null | undefined,
  module: keyof VenuePermissions,
  level: 'view' | 'edit',
  notFound = 'Not found',
): Promise<Ctx | Response> {
  if (!entityVenueId) {
    const ctx = await requireVenue(null, 'bookings', 'view')
    return ctx instanceof Response && ctx.status === 401 ? ctx : jsonError(404, notFound)
  }
  const ctx = await requireVenue(entityVenueId, module, level)
  if (ctx instanceof Response && ctx.status === 403) {
    const body = (await ctx.clone().json()) as { error: string }
    return body.error === 'Forbidden' ? jsonError(404, notFound) : ctx
  }
  return ctx
}

export const isId = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(v)
