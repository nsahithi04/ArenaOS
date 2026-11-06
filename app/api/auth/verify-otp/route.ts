import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST(req: Request) {
  try {
    const { email, otp } = await req.json();

    if (!email || !otp) {
      return NextResponse.json(
        { error: "Email and code are required" },
        { status: 400 },
      );
    }

    const record = await prisma.passwordResetOtp.findFirst({
      where: { email, otp },
    });

    if (!record) {
      return NextResponse.json({ error: "Invalid code" }, { status: 400 });
    }

    if (record.expiresAt < new Date()) {
      await prisma.passwordResetOtp.delete({ where: { id: record.id } });
      return NextResponse.json(
        { error: "Code has expired — request a new one" },
        { status: 400 },
      );
    }

    // Mark as verified so reset-password knows step 2 was completed
    await prisma.passwordResetOtp.update({
      where: { id: record.id },
      data: { verified: true },
    });

    return NextResponse.json({ valid: true });
  } catch (err) {
    console.error("[verify-otp]", err);
    return NextResponse.json({ error: "Verification failed" }, { status: 500 });
  }
}
