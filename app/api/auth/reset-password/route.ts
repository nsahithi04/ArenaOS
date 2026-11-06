import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { email, otp, password } = await req.json()

    if (!email || !otp || !password) {
      return NextResponse.json({ error: 'All fields are required' }, { status: 400 })
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    const record = await prisma.passwordResetOtp.findFirst({
      where: { email, otp },
    })

    if (!record) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    if (record.expiresAt < new Date()) {
      await prisma.passwordResetOtp.delete({ where: { id: record.id } })
      return NextResponse.json({ error: 'Code has expired — request a new one' }, { status: 400 })
    }

    if (!record.verified) {
      return NextResponse.json({ error: 'OTP not verified' }, { status: 400 })
    }

    const hashed = await bcrypt.hash(password, 12)

    await prisma.$transaction([
      prisma.user.update({ where: { email }, data: { password: hashed } }),
      prisma.passwordResetOtp.deleteMany({ where: { email } }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[reset-password]', err)
    return NextResponse.json({ error: 'Password reset failed' }, { status: 500 })
  }
}
