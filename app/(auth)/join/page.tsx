'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn, useSession } from 'next-auth/react'
import { Logo } from '@/components/brand/logo'
import { Eye, EyeOff, Check, Loader2 } from 'lucide-react'

type InviteInfo = {
  email: string
  name: string
  venueName: string
  roleName: string
  hasAccount: boolean
  isActive: boolean
}

function JoinContent() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const { data: session, status, update } = useSession()
  const token = searchParams.get('token') ?? ''

  const [info,    setInfo]    = useState<InviteInfo | null>(null)
  const [invalid, setInvalid] = useState('')
  const [loading, setLoading] = useState(true)

  // Sign-up form state
  const [password,    setPassword]    = useState('')
  const [showPass,    setShowPass]    = useState(false)
  const [submitting,  setSubmitting]  = useState(false)
  const [error,       setError]       = useState('')
  const [done,        setDone]        = useState(false)

  // Step: 'loading' | 'already-active' | 'logged-in-link' | 'choose' | 'signup' | 'login'
  const [step, setStep] = useState<'loading' | 'already-active' | 'logged-in-link' | 'choose' | 'signup' | 'login'>('loading')

  useEffect(() => {
    if (!token) { setInvalid('No invite token found.'); setLoading(false); return }

    fetch(`/api/join?token=${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { setInvalid(data.error); return }
        setInfo(data)
        if (data.isActive) { setStep('already-active'); return }
        // Will decide step after session resolves
      })
      .catch(() => setInvalid('Failed to load invite.'))
      .finally(() => setLoading(false))
  }, [token])

  // Once we have info AND session status resolved, pick the right step
  useEffect(() => {
    if (!info || info.isActive || status === 'loading') return
    if (status === 'authenticated') {
      setStep('logged-in-link')
    } else {
      setStep(info.hasAccount ? 'login' : 'choose')
    }
  }, [info, status])

  const linkAccount = async () => {
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'link' }),
      })
      if (!res.ok) { setError((await res.json()).error); return }
      // Force the JWT to re-fetch permissions (trigger==='update' resets TTL)
      await update()
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch { setError('Something went wrong') }
    finally { setSubmitting(false) }
  }

  const signUpAndJoin = async () => {
    setSubmitting(true); setError('')
    try {
      const res = await fetch('/api/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: 'signup', password }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }

      // Sign in with new credentials
      const result = await signIn('credentials', { email: data.email, password, redirect: false })
      if (result?.error) { setError('Account created but sign-in failed. Please log in.'); return }

      setDone(true)
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch { setError('Something went wrong') }
    finally { setSubmitting(false) }
  }

  const inp = 'w-full px-4 py-3 rounded-xl border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  if (loading || status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    )
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted p-6">
        <div className="bg-white rounded-2xl border border-border p-8 max-w-sm w-full text-center">
          <Logo size="md" className="mx-auto mb-6" />
          <p className="text-red-500 text-sm font-medium">{invalid}</p>
          <button onClick={() => router.push('/login')} className="mt-4 text-sm text-primary underline">Go to login</button>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted">
        <div className="bg-white rounded-2xl border border-border p-8 max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
            <Check size={28} className="text-green-600" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">You're in!</h2>
          <p className="text-sm text-muted-foreground mt-1">Redirecting to your dashboard…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted p-6">
      <div className="bg-white rounded-2xl border border-border p-8 max-w-sm w-full">
        <Logo size="md" className="mb-6" />

        {/* Invite context */}
        {info && (
          <div className="mb-6 p-4 rounded-xl bg-green-50 border border-green-100">
            <p className="text-sm text-foreground">
              You've been invited to join <strong>{info.venueName}</strong> as a{' '}
              <span className="text-green-700 font-semibold">{info.roleName}</span>.
            </p>
            <p className="text-xs text-muted-foreground mt-1">{info.email}</p>
          </div>
        )}

        {error && <p className="mb-4 text-sm text-red-500">{error}</p>}

        {/* Already active */}
        {step === 'already-active' && (
          <div className="text-center">
            <p className="text-sm text-muted-foreground mb-4">This invite has already been accepted.</p>
            <button onClick={() => router.push('/dashboard')} className="w-full py-2.5 rounded-xl text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              Go to Dashboard
            </button>
          </div>
        )}

        {/* Logged in — just link */}
        {step === 'logged-in-link' && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium text-foreground">Logged in as</p>
              <p className="text-sm text-muted-foreground">{session?.user?.email}</p>
            </div>
            <button onClick={linkAccount} disabled={submitting}
              className="w-full py-3 rounded-xl text-sm font-medium text-white disabled:opacity-60 transition-all"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              {submitting ? 'Joining…' : `Join ${info?.venueName}`}
            </button>
            <button onClick={() => signIn(undefined, { callbackUrl: `/join?token=${token}` })}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground">
              Use a different account
            </button>
          </div>
        )}

        {/* Choose: sign up or log in */}
        {step === 'choose' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground mb-2">How would you like to join?</p>
            <button onClick={() => setStep('signup')}
              className="w-full py-3 rounded-xl text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              Create a new account
            </button>
            <button onClick={() => setStep('login')}
              className="w-full py-3 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
              I already have an account
            </button>
          </div>
        )}

        {/* Sign up */}
        {step === 'signup' && (
          <div className="space-y-4">
            <h2 className="text-base font-semibold text-foreground">Create your account</h2>
            <div>
              <label className="block text-sm font-medium mb-1.5">Email</label>
              <input value={info?.email ?? ''} disabled className={`${inp} bg-muted/50 text-muted-foreground`} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Password</label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimum 8 characters" className={`${inp} pr-10`}
                  onKeyDown={(e) => e.key === 'Enter' && signUpAndJoin()} />
                <button type="button" onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <button onClick={signUpAndJoin} disabled={submitting || password.length < 8}
              className="w-full py-3 rounded-xl text-sm font-medium text-white disabled:opacity-60 transition-all"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              {submitting ? 'Creating account…' : 'Create account & Join'}
            </button>
            <button onClick={() => setStep('choose')} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
        )}

        {/* Log in */}
        {step === 'login' && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Log in to your existing account to accept this invite.</p>
            <button
              onClick={() => signIn(undefined, { callbackUrl: `/join?token=${token}` })}
              className="w-full py-3 rounded-xl text-sm font-medium text-white"
              style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
              Log in
            </button>
            <button onClick={() => setStep('choose')} className="w-full text-center text-xs text-muted-foreground hover:text-foreground">← Back</button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function JoinPage() {
  return (
    <Suspense>
      <JoinContent />
    </Suspense>
  )
}
