import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { parsePermissions } from '@/lib/team/presets'

type Params = { params: Promise<{ id: string; roleId: string }> }

async function ownerAndRole(id: string, roleId: string) {
  const ctx = await requireVenue(id, 'team', 'edit')
  if (ctx instanceof Response) return ctx
  if (!ctx.access.isOwner) return jsonError(403, 'Only the owner can change roles')
  const role = await prisma.venueRole.findFirst({ where: { id: roleId, venueId: id } })
  if (!role) return jsonError(404, 'Role not found')
  if (role.preset) return jsonError(403, `${role.name} is a built-in role and can't be changed`)
  return role
}

// PATCH /api/venues/:id/roles/:roleId — edit a custom role (owner only)
export async function PATCH(req: Request, { params }: Params) {
  const { id, roleId } = await params
  const role = await ownerAndRole(id, roleId)
  if (role instanceof Response) return role
  try {
    const { name, color, permissions } = (await readJson(req)) as Record<string, unknown>
    const perms = permissions === undefined ? undefined : parsePermissions(permissions)
    if (perms === null) return jsonError(400, 'Invalid permissions')
    if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 60)) return jsonError(400, 'Invalid role name')
    const updated = await prisma.venueRole.update({
      where: { id: role.id },
      data: {
        ...(typeof name === 'string' && { name: name.trim() }),
        ...(typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) && { color }),
        ...(perms && { permissions: perms }),
      },
    })
    return NextResponse.json(updated)
  } catch (err) {
    return handleError(err, 'roles PATCH')
  }
}

// DELETE /api/venues/:id/roles/:roleId — delete a custom role (owner only). Its members are left with no access.
export async function DELETE(_req: Request, { params }: Params) {
  const { id, roleId } = await params
  const role = await ownerAndRole(id, roleId)
  if (role instanceof Response) return role
  try {
    await prisma.venueRole.delete({ where: { id: role.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'roles DELETE')
  }
}
