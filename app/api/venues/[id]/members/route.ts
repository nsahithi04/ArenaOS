import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { sendInviteEmail } from '@/lib/mail'
import crypto from 'crypto'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  // Must be owner or active member of this venue
  const owned = await prisma.venue.findFirst({ where: { id, ownerId: session.user.id } })
  if (!owned) {
    const member = await prisma.venueMember.findFirst({ where: { venueId: id, userId: session.user.id, status: 'active' } })
    if (!member) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const members = await prisma.venueMember.findMany({
    where: { venueId: id },
    include: { role: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json(members)
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const venue = await prisma.venue.findFirst({
    where: { id, ownerId: session.user.id },
    include: { owner: true },
  })
  if (!venue) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  try {
    const { name, email, roleId } = await req.json()

    const existingUser = await prisma.user.findUnique({ where: { email } })
    const inviteToken = crypto.randomBytes(32).toString('hex')
    const inviteExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000) // 48 hours

    const role = roleId ? await prisma.venueRole.findUnique({ where: { id: roleId } }) : null

    const member = await prisma.venueMember.create({
      data: {
        venueId: id,
        name,
        email,
        roleId: roleId || null,
        userId: existingUser?.id ?? null,
        status: existingUser ? 'active' : 'invited',
        inviteToken,
        inviteExpiry,
      },
      include: { role: true },
    })

    // Send email — different copy depending on whether user already has an account
    const isExistingUser = !!existingUser
    const inviteUrl = isExistingUser
      ? `${process.env.NEXTAUTH_URL}/dashboard`
      : `${process.env.NEXTAUTH_URL}/join?token=${inviteToken}`
    try {
      await sendInviteEmail(email, {
        inviterName: venue.owner.name ?? 'The venue owner',
        venueName: venue.name,
        roleName: role?.name ?? 'Team Member',
        inviteUrl,
        isExistingUser,
      })
    } catch (mailErr) {
      console.error('[invite email]', mailErr)
      // Don't fail the request if email fails — member is still added
    }

    return NextResponse.json(member)
  } catch (err: unknown) {
    if ((err as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'This email is already a member' }, { status: 409 })
    }
    console.error('[members POST]', err)
    return NextResponse.json({ error: 'Failed to add member' }, { status: 500 })
  }
}
