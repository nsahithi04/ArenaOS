import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const { email, otp } = await req.json()

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and code are required' }, { status: 400 })
    }

    const record = await prisma.verificationToken.findUnique({
      where: { identifier_token: { identifier: email, token: otp } },
    })

    if (!record) {
      return NextResponse.json({ error: 'Invalid code' }, { status: 400 })
    }

    if (record.expires < new Date()) {
      await prisma.verificationToken.delete({
        where: { identifier_token: { identifier: email, token: otp } },
      })
      return NextResponse.json({ error: 'Code has expired — request a new one' }, { status: 400 })
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { email },
        data: { emailVerified: new Date() },
      }),
      prisma.verificationToken.delete({
        where: { identifier_token: { identifier: email, token: otp } },
      }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[verify-email]', err)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
