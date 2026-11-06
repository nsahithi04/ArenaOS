'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Logo } from '@/components/brand/logo'
import { Eye, EyeOff, ArrowRight, CheckCircle } from 'lucide-react'

function LoginContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPass, setShowPass] = useState(false)
  const [remember, setRemember] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const verified = searchParams.get('verified') === '1'

  useEffect(() => {
    const emailParam = searchParams.get('email')
    if (emailParam) setEmail(emailParam)
  }, [searchParams])

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (result?.error) {
      setError('Invalid email or password')
    } else {
      const venuesRes = await fetch('/api/venues')
      const venues = await venuesRes.json()
      if (Array.isArray(venues) && venues.length === 0) {
        router.push('/onboarding')
      } else {
        router.push('/dashboard')
      }
    }
  }

  return (
    <div className="min-h-screen bg-white flex">
      {/* Left panel */}
      <div
        className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col gap-50 p-12"
        style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e3a5f 50%, #0f4c2a 100%)' }}
      >
        <div className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #22c55e, transparent)', transform: 'translate(30%, -30%)' }} />
        <div className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-10"
          style={{ background: 'radial-gradient(circle, #3b82f6, transparent)', transform: 'translate(-30%, 30%)' }} />

        <Logo dark size="lg" />

        <div className="relative z-10">
          <h2 className="text-4xl font-semibold text-white leading-tight mb-4">
            Manage your sports<br />
            <span style={{ color: '#4ade80' }}>venues smarter.</span>
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed mb-10">
            The all-in-one platform for badminton courts, tennis clubs, football grounds, and more.
          </p>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8">
            <Logo size="lg" />
          </div>

          {/* Email verified banner */}
          {verified && (
            <div className="flex items-center gap-2.5 px-4 py-3 rounded-lg bg-green-50 border border-green-200 mb-6">
              <CheckCircle size={16} className="text-green-600 flex-shrink-0" />
              <p className="text-sm text-green-700 font-medium">
                Email verified! Sign in to continue.
              </p>
            </div>
          )}

          <div className="mb-8">
            <h1 className="text-2xl font-semibold text-foreground">Welcome back</h1>
            <p className="text-muted-foreground mt-1.5">Sign in to your GameOn account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                placeholder="you@venue.com"
                required
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-foreground">Password</label>
                <button type="button" onClick={() => router.push('/forgot-password')}
                  className="text-sm text-primary hover:underline">
                  Forgot password?
                </button>
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-2.5 pr-11 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                  placeholder="Enter your password"
                  required
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <label className="flex items-center gap-2.5 cursor-pointer">
              <div onClick={() => setRemember(!remember)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors ${remember ? 'bg-primary border-primary' : 'border-border'}`}>
                {remember && (
                  <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </div>
              <span className="text-sm text-muted-foreground">Remember me for 30 days</span>
            </label>

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}>
              {loading ? 'Signing in…' : 'Sign in to GameOn'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-border text-center">
            <p className="text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <button onClick={() => router.push('/signup')} className="text-primary font-medium hover:underline">
                Create one free
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
