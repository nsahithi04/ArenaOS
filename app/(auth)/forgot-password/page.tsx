'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Logo } from '@/components/brand/logo'
import { ArrowLeft, ArrowRight, Mail, Shield, Eye, EyeOff, Check, RefreshCw } from 'lucide-react'

function ForgotPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [email, setEmail] = useState('')

  useEffect(() => {
    const pre = searchParams.get('email')
    if (pre) setEmail(pre)
  }, [searchParams])
  const [otp, setOtp] = useState(['', '', '', '', '', ''])
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const otpString = otp.join('')

  const handleOtp = (i: number, v: string) => {
    if (!/^\d*$/.test(v)) return
    if (v.length > 1) return
    const next = [...otp]
    next[i] = v
    setOtp(next)
    if (v && i < 5) document.getElementById(`otp-${i + 1}`)?.focus()
  }

  const handleOtpKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus()
    }
  }

  const handleSendCode = async () => {
    if (!email) { setError('Please enter your email'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to send code'); return }
      setStep(2)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOtp = async () => {
    if (otpString.length < 6) { setError('Enter the 6-digit code'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otpString }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Invalid code'); return }
      setStep(3)
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (newPass !== confirmPass) { setError('Passwords do not match'); return }
    if (newPass.length < 8) { setError('Password must be at least 8 characters'); return }
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp: otpString, password: newPass }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Reset failed'); return }
      router.push('/login?reset=1')
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  const stepConfig = [
    { num: 1, label: 'Email' },
    { num: 2, label: 'Verify OTP' },
    { num: 3, label: 'New Password' },
  ]

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-6">
          <Logo size="lg" />
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-0 mb-8">
          {stepConfig.map((s, i) => (
            <div key={s.num} className="flex items-center">
              <div className="flex flex-col items-center gap-1">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-all ${
                    step > s.num
                      ? 'bg-primary text-white'
                      : step === s.num
                      ? 'text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  style={step === s.num ? { background: 'linear-gradient(135deg, #16a34a, #2563eb)' } : {}}
                >
                  {step > s.num ? <Check size={14} /> : s.num}
                </div>
                <span className={`text-xs ${step === s.num ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                  {s.label}
                </span>
              </div>
              {i < 2 && (
                <div className={`w-16 h-0.5 mb-5 mx-1 transition-colors ${step > s.num ? 'bg-primary' : 'bg-border'}`} />
              )}
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">

          {/* Step 1 — Email */}
          {step === 1 && (
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center mb-5">
                <Mail size={22} className="text-blue-600" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Forgot your password?</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we&apos;ll send a 6-digit verification code.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Email address</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                    placeholder="you@venue.com"
                    className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  />
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  onClick={handleSendCode}
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
                >
                  {loading ? 'Sending…' : (<>Send Verification Code <ArrowRight size={16} /></>)}
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — OTP */}
          {step === 2 && (
            <div>
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
                <Shield size={22} className="text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Enter verification code</h2>
              <p className="text-sm text-muted-foreground mb-6">
                We sent a 6-digit code to{' '}
                <span className="font-medium text-foreground">{email}</span>
              </p>
              <div className="flex gap-2 justify-between mb-3">
                {otp.map((val, i) => (
                  <input
                    key={i}
                    id={`otp-${i}`}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={val}
                    onChange={(e) => handleOtp(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    className="w-11 h-12 text-center rounded-lg border-2 text-lg font-semibold outline-none transition-all focus:border-primary"
                    style={{ borderColor: val ? '#16a34a' : '#e2e8f0' }}
                  />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mb-4">Code expires in 10 minutes.</p>
              {error && <p className="text-sm text-red-500 mb-3">{error}</p>}
              <button
                onClick={handleVerifyOtp}
                disabled={loading || otpString.length < 6}
                className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50 mb-3"
                style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
              >
                {loading ? 'Verifying…' : (<>Verify Code <ArrowRight size={16} /></>)}
              </button>
              <button
                onClick={() => { setOtp(['','','','','','']); handleSendCode() }}
                className="w-full py-2 text-sm text-muted-foreground hover:text-foreground flex items-center justify-center gap-1.5 transition-colors"
              >
                <RefreshCw size={13} /> Resend code
              </button>
            </div>
          )}

          {/* Step 3 — New Password */}
          {step === 3 && (
            <div>
              <div className="w-12 h-12 rounded-xl bg-green-50 flex items-center justify-center mb-5">
                <Check size={22} className="text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-foreground mb-1">Set new password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Identity verified. Choose a strong password.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">New Password</label>
                  <div className="relative">
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      placeholder="Min. 8 characters"
                      className="w-full px-4 py-2.5 pr-10 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                    <button type="button" onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showNew ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">Confirm New Password</label>
                  <div className="relative">
                    <input
                      type={showConfirm ? 'text' : 'password'}
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      placeholder="Repeat new password"
                      className="w-full px-4 py-2.5 pr-10 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                    <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                  {confirmPass && confirmPass === newPass && (
                    <p className="text-xs mt-1 text-green-600 flex items-center gap-1">
                      <Check size={11} /> Passwords match
                    </p>
                  )}
                </div>
                {error && <p className="text-sm text-red-500">{error}</p>}
                <button
                  onClick={handleResetPassword}
                  disabled={loading}
                  className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 hover:opacity-90 transition-all disabled:opacity-50"
                  style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}
                >
                  {loading ? 'Resetting…' : (<>Reset Password <ArrowRight size={16} /></>)}
                </button>
              </div>
            </div>
          )}
        </div>

        <button
          onClick={() => router.push('/login')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mx-auto mt-5 transition-colors"
        >
          <ArrowLeft size={14} /> Back to login
        </button>
      </div>
    </div>
  )
}

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordContent />
    </Suspense>
  )
}
