import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { canManageRole } from '@/lib/team/presets'

type Params = { params: Promise<{ id: string; memberId: string }> }

async function loadMember(venueId: string, memberId: string) {
  // Scoped to the venue so IDs from other venues can't be touched.
  return prisma.venueMember.findFirst({ where: { id: memberId, venueId }, include: { role: true } })
}

// PATCH /api/venues/:id/members/:memberId — change someone's role (needs team:edit)
export async function PATCH(req: Request, { params }: Params) {
  const { id, memberId } = await params
  const ctx = await requireVenue(id, 'team', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const member = await loadMember(id, memberId)
    if (!member) return jsonError(404, 'Team member not found')
    if (member.userId === ctx.userId) return jsonError(403, "You can't change your own role")
    if (!canManageRole(ctx.access, member.role)) return jsonError(403, 'Only the owner can change a manager')

    const { roleId } = (await readJson(req)) as { roleId?: unknown }
    if (typeof roleId !== 'string' || !roleId) return jsonError(400, 'roleId is required')
    const role = await prisma.venueRole.findFirst({ where: { id: roleId, venueId: id } })
    if (!role) return jsonError(400, 'Role not found for this venue')
    if (!canManageRole(ctx.access, role)) return jsonError(403, 'Only the owner can make someone a manager')

    const updated = await prisma.venueMember.update({
      where: { id: member.id },
      data: { roleId: role.id },
      select: { id: true, roleId: true, role: { select: { id: true, name: true, color: true, preset: true, permissions: true } } },
    })
    return NextResponse.json(updated)
  } catch (err) {
    return handleError(err, 'members PATCH')
  }
}

// DELETE /api/venues/:id/members/:memberId — remove from the team (needs team:edit)
export async function DELETE(_req: Request, { params }: Params) {
  const { id, memberId } = await params
  const ctx = await requireVenue(id, 'team', 'edit')
  if (ctx instanceof Response) return ctx
  try {
    const member = await loadMember(id, memberId)
    if (!member) return jsonError(404, 'Team member not found')
    if (member.userId === ctx.userId) return jsonError(403, "You can't remove yourself")
    if (!canManageRole(ctx.access, member.role)) return jsonError(403, 'Only the owner can remove a manager')
    await prisma.venueMember.delete({ where: { id: member.id } })
    return NextResponse.json({ success: true })
  } catch (err) {
    return handleError(err, 'members DELETE')
  }
}
