import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/db'
import { sendOtpEmail } from '@/lib/mail'

export async function POST(req: Request) {
  try {
    const { email } = await req.json()

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    // Return success even if email not found — don't leak registered emails
    if (!user) {
      return NextResponse.json({ success: true })
    }

    const otp = crypto.randomInt(100000, 1000000).toString()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    // Delete any existing OTP for this email before creating a fresh one
    await prisma.passwordResetOtp.deleteMany({ where: { email } })

    await prisma.passwordResetOtp.create({
      data: { email, otp, expiresAt },
    })

    await sendOtpEmail(email, otp)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[send-otp]', err)
    return NextResponse.json({ error: 'Failed to send code' }, { status: 500 })
  }
}
