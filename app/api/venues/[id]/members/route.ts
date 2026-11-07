import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { sendInviteEmail } from '@/lib/mail'
import { hasPermission } from '@/lib/booking/access'
import { handleError, jsonError, readJson, requireVenue } from '@/lib/booking/route-helpers'
import { canManageRole, ensurePresetRoles } from '@/lib/team/presets'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Never include invite tokens in responses: anyone holding one can claim the seat.
const memberSelect = {
  id: true, name: true, email: true, roleId: true, status: true, userId: true, createdAt: true,
  role: { select: { id: true, name: true, color: true, preset: true, permissions: true } },
} as const

// GET /api/venues/:id/members — team list (needs team:view)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'team', 'view')
  if (ctx instanceof Response) return ctx

  const [venue, members] = await Promise.all([
    prisma.venue.findUniqueOrThrow({ where: { id }, select: { owner: { select: { id: true, name: true, email: true } } } }),
    prisma.venueMember.findMany({ where: { venueId: id }, select: memberSelect, orderBy: { createdAt: 'asc' } }),
  ])
  return NextResponse.json({
    owner: venue.owner,
    members: members.map((m) => ({ ...m, isYou: m.userId === ctx.userId, canManage: canManageRole(ctx.access, m.role) })),
    canEdit: hasPermission(ctx.access, 'team', 'edit'),
    isOwner: ctx.access.isOwner,
  })
}

// POST /api/venues/:id/members — invite someone (needs team:edit; managers can only invite non-managers)
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireVenue(id, 'team', 'edit')
  if (ctx instanceof Response) return ctx

  try {
    const body = (await readJson(req)) as Record<string, unknown>
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!name || name.length > 120) return jsonError(400, 'Name is required (max 120 characters)')
    if (!EMAIL_RE.test(email) || email.length > 254) return jsonError(400, 'Enter a valid email address')

    await ensurePresetRoles(prisma, id)
    const role = typeof body.roleId === 'string' && body.roleId
      ? await prisma.venueRole.findFirst({ where: { id: body.roleId, venueId: id } })
      : await prisma.venueRole.findFirst({ where: { venueId: id, preset: 'EMPLOYEE' } })
    if (!role) return jsonError(400, 'Role not found for this venue')
    if (!canManageRole(ctx.access, role)) return jsonError(403, 'Only the owner can add managers')

    const venue = await prisma.venue.findUniqueOrThrow({ where: { id }, select: { name: true, ownerId: true } })
    const existingUser = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existingUser?.id === venue.ownerId) return jsonError(400, 'That is the venue owner')
    const actor = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { name: true } })

    const member = await prisma.venueMember.create({
      data: {
        venueId: id,
        name,
        email,
        roleId: role.id,
        userId: existingUser?.id ?? null,
        status: existingUser ? 'active' : 'invited',
        inviteToken: crypto.randomBytes(32).toString('hex'),
        inviteExpiry: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
      select: { ...memberSelect, inviteToken: true },
    })

    const base = process.env.NEXTAUTH_URL ?? ''
    try {
      await sendInviteEmail(email, {
        inviterName: actor?.name ?? 'Your venue',
        venueName: venue.name,
        roleName: role.name,
        inviteUrl: existingUser ? `${base}/dashboard` : `${base}/join?token=${member.inviteToken}`,
        isExistingUser: !!existingUser,
      })
    } catch (mailErr) {
      console.error('[invite email]', mailErr) // member is still added; the owner can re-invite
    }

    const { inviteToken: _t, ...safe } = member
    void _t
    return NextResponse.json({ ...safe, isYou: false, canManage: true }, { status: 201 })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') return jsonError(409, 'This email is already on the team')
    return handleError(err, 'members POST')
  }
}
