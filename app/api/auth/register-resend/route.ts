import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { sendVerificationEmail } from '@/lib/mail'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    if (user.emailVerified) {
      return NextResponse.json({ error: 'Email already verified' }, { status: 400 })
    }

    const otp = crypto.randomInt(100000, 1000000).toString()
    const expires = new Date(Date.now() + 10 * 60 * 1000)

    await prisma.verificationToken.deleteMany({ where: { identifier: email } })
    await prisma.verificationToken.create({
      data: { identifier: email, token: otp, expires },
    })

    await sendVerificationEmail(email, otp)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[register-resend]', err)
    return NextResponse.json({ error: 'Failed to resend' }, { status: 500 })
  }
}
