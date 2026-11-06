import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/mail'

export async function POST(req: Request) {
  try {
    const { name, email, password, phone } = await req.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 },
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 },
      )
    }

    const hashed = await bcrypt.hash(password, 12)

    await prisma.user.create({
      data: { name, email, password: hashed, phone, role: 'VENUE_OWNER' },
    })

    // Generate email verification OTP
    const otp = crypto.randomInt(100000, 1000000).toString()
    const expires = new Date(Date.now() + 10 * 60 * 1000)

    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token: otp, expires },
    })

    await sendVerificationEmail(email, otp)

    return NextResponse.json({ email }, { status: 201 })
  } catch (err) {
    console.error('[register]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
