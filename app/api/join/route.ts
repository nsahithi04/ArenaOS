import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { auth } from '@/auth'
import bcrypt from 'bcryptjs'

// GET — validate a token and return invite info (no auth required)
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const member = await prisma.venueMember.findUnique({
    where: { inviteToken: token },
    include: { venue: true, role: true },
  })

  if (!member) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  if (member.inviteExpiry && member.inviteExpiry < new Date()) {
    return NextResponse.json({ error: 'This invite link has expired' }, { status: 410 })
  }

  return NextResponse.json({
    email: member.email,
    name: member.name,
    venueName: member.venue.name,
    roleName: member.role?.name ?? 'Team Member',
    hasAccount: !!member.userId,
    isActive: member.status === 'active',
  })
}

// POST — accept invite (link logged-in user OR create new account)
export async function POST(req: Request) {
  const { token, action, password } = await req.json() as {
    token: string
    action: 'link' | 'signup'
    password?: string
  }

  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const member = await prisma.venueMember.findUnique({
    where: { inviteToken: token },
    include: { venue: true },
  })

  if (!member) return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  if (member.inviteExpiry && member.inviteExpiry < new Date()) {
    return NextResponse.json({ error: 'Invite link has expired' }, { status: 410 })
  }

  if (action === 'link') {
    // User is already logged in — link their account
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Not logged in' }, { status: 401 })

    await prisma.venueMember.update({
      where: { id: member.id },
      data: { userId: session.user.id, status: 'active', inviteToken: null, inviteExpiry: null },
    })
    return NextResponse.json({ success: true })
  }

  if (action === 'signup') {
    if (!password || password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Check if account already exists
    const existing = await prisma.user.findUnique({ where: { email: member.email } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists. Please log in instead.' }, { status: 409 })
    }

    const hashed = await bcrypt.hash(password, 12)
    const user = await prisma.user.create({
      data: {
        email: member.email,
        name: member.name,
        password: hashed,
        emailVerified: new Date(),
        role: 'STAFF',
      },
    })

    await prisma.venueMember.update({
      where: { id: member.id },
      data: { userId: user.id, status: 'active', inviteToken: null, inviteExpiry: null },
    })

    return NextResponse.json({ success: true, email: member.email })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
