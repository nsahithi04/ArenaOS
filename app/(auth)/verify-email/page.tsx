'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Logo } from '@/components/logo'
import { Shield, ArrowLeft, RefreshCw, ArrowRight } from 'lucide-react'

function VerifyEmailContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const email = searchParams.get('email') ?? ''

  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(60)

  useEffect(() => {
    if (!email) router.push('/signup')
  }, [email, router])

  // Countdown for resend button
  useEffect(() => {
    if (countdown <= 0) return
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [countdown])

  const handleOtp = (i: number, v: string) => {
    if (!/^\d*$/.test(v)) return
    if (v.length > 1) return
    const next = [...otp]
    next[i] = v
    setOtp(next)
    if (v && i < 5) document.getElementById(`otp-${i + 1}`)?.focus()
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (!text) return
    e.preventDefault()
    const next = [...otp]
    text.split('').forEach((ch, i) => { next[i] = ch })
    setOtp(next)
    document.getElementById(`otp-${Math.min(text.length, 5)}`)?.focus()
  }

  const handleVerify = async () => {
    const code = otp.join('')
    if (code.length < 6) { setError('Enter the 6-digit code'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Verification failed'); return }

      const savedPass = sessionStorage.getItem('gameon_signup_pass')
      if (savedPass) {
        sessionStorage.removeItem('gameon_signup_pass')
        const result = await signIn('credentials', { email, password: savedPass, redirect: false })
        if (!result?.error) {
          router.push('/onboarding')
          return
        }
      }
      router.push(`/login?verified=1&email=${encodeURIComponent(email)}`)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setError('')
    setOtp(['', '', '', '', '', ''])
    try {
      await fetch('/api/auth/register-resend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      setCountdown(60)
    } catch {
      setError('Failed to resend. Try again.')
    } finally {
      setResending(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
            <Shield size={22} className="text-green-600" />
          </div>

          <h2 className="text-xl font-semibold text-foreground mb-1">Verify your email</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We sent a 6-digit code to{' '}
            <span className="font-medium text-foreground">{email}</span>
            <br />Enter it below to activate your account.
          </p>

          <div className="flex gap-2 justify-between mb-3" onPaste={handlePaste}>
            {otp.map((val, i) => (
              <input
                key={i}
                id={`otp-${i}`}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={val}
                onChange={(e) => handleOtp(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                className="w-11 h-12 text-center rounded-lg border-2 text-lg font-semibold outline-none transition-all focus:border-primary"
                style={{ borderColor: val ? '#16a34a' : '#e2e8f0' }}
              />
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-4">Code expires in 10 minutes.</p>

          {error && <p className="text-sm text-red-500 mb-3">{error}</p>}

          <button
            onClick={handleVerify}
            disabled={loading || otp.join('').length < 6}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 mb-3"
            style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
          >
            {loading ? 'Verifying…' : (<>Verify & Continue <ArrowRight size={16} /></>)}
          </button>

          <button
            onClick={handleResend}
            disabled={resending || countdown > 0}
            className="w-full py-2 text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} />
            {countdown > 0 ? `Resend in ${countdown}s` : resending ? 'Sending…' : 'Resend code'}
          </button>
        </div>

        <button
          onClick={() => router.push('/signup')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mx-auto mt-5 transition-colors"
        >
          <ArrowLeft size={14} /> Back to sign up
        </button>
      </div>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailContent />
    </Suspense>
  )
}
