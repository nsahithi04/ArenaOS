import nodemailer from 'nodemailer'

function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
})

async function send(options: nodemailer.SendMailOptions) {
  const info = await transporter.sendMail(options)
  console.log('[mail] sent →', info.messageId, '| to:', options.to)
  return info
}

export async function sendVerificationEmail(to: string, otp: string) {
  return send({
    from: `"GameOn" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Verify your GameOn account',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <div style="margin-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#16a34a;">GameOn</span>
        </div>
        <h2 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px;">Verify your email address</h2>
        <p style="color:#64748b;font-size:14px;margin:0 0 28px;">Enter this code to activate your GameOn account. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#16a34a;">${otp}</span>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't create a GameOn account, you can safely ignore this email.</p>
      </div>
    `,
  })
}

export async function sendInviteEmail(to: string, opts: { inviterName: string; venueName: string; roleName: string; inviteUrl: string; isExistingUser?: boolean }) {
  const inviter  = esc(opts.inviterName)
  const venue    = esc(opts.venueName)
  const role     = esc(opts.roleName)

  const body = opts.isExistingUser
    ? `<p style="color:#64748b;font-size:14px;margin:0 0 28px;">
        <strong style="color:#0f172a;">${inviter}</strong> has added you to
        <strong style="color:#0f172a;">${venue}</strong> as a <strong style="color:#16a34a;">${role}</strong>.
        Head to your dashboard to get started.
       </p>
       <a href="${opts.inviteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;margin-bottom:28px;">
         Go to Dashboard
       </a>`
    : `<p style="color:#64748b;font-size:14px;margin:0 0 6px;">
        <strong style="color:#0f172a;">${inviter}</strong> has invited you to join
        <strong style="color:#0f172a;">${venue}</strong> as a <strong style="color:#16a34a;">${role}</strong>.
       </p>
       <p style="color:#64748b;font-size:14px;margin:0 0 28px;">Click below to accept the invitation and set up your account.</p>
       <a href="${opts.inviteUrl}"
         style="display:inline-block;background:linear-gradient(135deg,#16a34a,#15803d);color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 28px;border-radius:8px;margin-bottom:28px;">
         Accept Invitation
       </a>
       <p style="color:#94a3b8;font-size:12px;margin:0;">This link expires in 48 hours. If you didn't expect this invite, you can ignore this email.</p>`

  return send({
    from: `"GameOn" <${process.env.EMAIL_USER}>`,
    to,
    subject: opts.isExistingUser
      ? `You've been added to ${opts.venueName} on GameOn`
      : `You've been invited to join ${opts.venueName} on GameOn`,
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <div style="margin-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#16a34a;">GameOn</span>
        </div>
        <h2 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px;">${opts.isExistingUser ? "You've been added!" : "You're invited!"}</h2>
        ${body}
      </div>
    `,
  })
}

export async function sendOtpEmail(to: string, otp: string) {
  return send({
    from: `"GameOn" <${process.env.EMAIL_USER}>`,
    to,
    subject: 'Your GameOn password reset code',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;">
        <div style="margin-bottom:24px;">
          <span style="font-size:22px;font-weight:700;color:#16a34a;">GameOn</span>
        </div>
        <h2 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px;">Password Reset Code</h2>
        <p style="color:#64748b;font-size:14px;margin:0 0 28px;">Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:24px;text-align:center;margin-bottom:28px;">
          <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#16a34a;">${otp}</span>
        </div>
        <p style="color:#94a3b8;font-size:12px;margin:0;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  })
}
