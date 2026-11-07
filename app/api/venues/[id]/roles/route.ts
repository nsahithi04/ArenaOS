import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { ensurePresetRoles, parsePermissions, PRESET_ORDER, PRESETS } from '@/lib/team/presets'

// GET /api/venues/:id/roles — built-in roles first, then custom ones (needs team:view)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'team', 'view')
  if (ctx instanceof Response) return ctx
  try {
    await ensurePresetRoles(prisma, id)
    const roles = await prisma.venueRole.findMany({
      where: { venueId: id },
      include: { _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    })
    const rank = (p: string | null) => (p ? PRESET_ORDER.indexOf(p as never) : 99)
    return NextResponse.json(
      roles
        .sort((a, b) => rank(a.preset) - rank(b.preset))
        .map((r) => ({
          id: r.id, name: r.name, color: r.color, permissions: r.permissions, preset: r.preset,
          description: r.preset ? PRESETS[r.preset].description : null,
          memberCount: r._count.members,
        })),
    )
  } catch (err) {
    return handleError(err, 'roles GET')
  }
}

// POST /api/venues/:id/roles — custom role (owner only)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'team', 'edit')
  if (ctx instanceof Response) return ctx
  if (!ctx.access.isOwner) return jsonError(403, 'Only the owner can create roles')
  try {
    const { name, color, permissions } = (await readJson(req)) as Record<string, unknown>
    const perms = parsePermissions(permissions)
    if (typeof name !== 'string' || !name.trim() || name.length > 60) return jsonError(400, 'Role name is required (max 60 characters)')
    if (!perms) return jsonError(400, 'Invalid permissions')
    if (PRESET_ORDER.some((k) => PRESETS[k].name.toLowerCase() === name.trim().toLowerCase())) {
      return jsonError(409, `"${name.trim()}" is a built-in role`)
    }
    const role = await prisma.venueRole.create({
      data: { venueId: id, name: name.trim(), color: typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color : '#16a34a', permissions: perms },
    })
    return NextResponse.json({ ...role, description: null, memberCount: 0 }, { status: 201 })
  } catch (err) {
    return handleError(err, 'roles POST')
  }
}
