import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, phone: true, role: true },
  })
  return NextResponse.json(user)
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { name, email, phone } = await req.json()
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(name  !== undefined && { name:  String(name).trim() }),
      ...(email !== undefined && { email: String(email).trim() }),
      ...(phone !== undefined && { phone: String(phone).trim() || null }),
    },
    select: { id: true, name: true, email: true, phone: true },
  })
  return NextResponse.json(user)
}
