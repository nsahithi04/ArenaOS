'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Logo } from '@/components/brand/logo'
import { Eye, EyeOff, ArrowRight, Check } from 'lucide-react'

export default function SignupPage() {
  const router = useRouter()
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ name: '', phone: '', email: '', password: '', confirm: '' })

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value })

  const strength = form.password.length === 0 ? 0 : form.password.length < 6 ? 1 : form.password.length < 10 ? 2 : 3
  const strengthColors = ['', '#ef4444', '#f59e0b', '#16a34a']
  const strengthLabels = ['', 'Weak', 'Fair', 'Strong']

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    setError('')
    setLoading(true)
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: form.name, email: form.email, password: form.password, phone: form.phone }),
    })
    setLoading(false)
    if (!res.ok) {
      try {
        const data = await res.json()
        setError(data.error ?? 'Something went wrong')
      } catch {
        setError('Something went wrong. Please try again.')
      }
    } else {
      const data = await res.json()
      sessionStorage.setItem('gameon_signup_pass', form.password)
      router.push(`/verify-email?email=${encodeURIComponent(data.email)}`)
    }
  }

  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-5">
            <Logo size="lg" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Create your account</h1>
          <p className="text-muted-foreground mt-1.5 text-sm">Join thousands of sports venue owners on GameOn</p>
        </div>

        <div className="bg-white rounded-2xl border border-border shadow-sm p-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">Full Name</label>
                <input type="text" value={form.name} onChange={set('name')} placeholder="Your name"
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number</label>
                <input type="tel" value={form.phone} onChange={set('phone')} placeholder="+1 (555) 000-0000"
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email Address</label>
                <input type="email" value={form.email} onChange={set('email')} placeholder="you@venue.com"
                  className="w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" required />
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} value={form.password} onChange={set('password')} placeholder="Min. 8 characters"
                    className="w-full px-4 py-2.5 pr-10 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" required />
                  <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {form.password && (
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex-1 flex gap-1">
                      {[1, 2, 3].map((i) => (
                        <div key={i} className="h-1 flex-1 rounded-full transition-colors"
                          style={{ background: i <= strength ? strengthColors[strength] : '#e2e8f0' }} />
                      ))}
                    </div>
                    <span className="text-xs" style={{ color: strengthColors[strength] }}>{strengthLabels[strength]}</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Confirm Password</label>
                <div className="relative">
                  <input type={showConfirm ? 'text' : 'password'} value={form.confirm} onChange={set('confirm')} placeholder="Repeat password"
                    className="w-full px-4 py-2.5 pr-10 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all" required />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
                {form.confirm && form.confirm === form.password && (
                  <p className="text-xs mt-1 text-green-600 flex items-center gap-1"><Check size={11} /> Passwords match</p>
                )}
              </div>
            </div>

            {error && <p className="text-sm text-red-500">{error}</p>}

            <label className="flex items-start gap-2.5 cursor-pointer mt-2">
              <div onClick={() => setAgreed(!agreed)}
                className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${agreed ? 'bg-primary border-primary' : 'border-border'}`}>
                {agreed && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
              <span className="text-sm text-muted-foreground leading-relaxed">
                I agree to GameOn&apos;s{' '}
                <a href="#" className="text-primary hover:underline">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="text-primary hover:underline">Privacy Policy</a>
              </span>
            </label>

            <button type="submit" disabled={!agreed || loading}
              className="w-full py-2.5 rounded-lg text-sm font-medium text-white flex items-center justify-center gap-2 transition-all hover:opacity-90 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed mt-2"
              style={{ background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)' }}>
              {loading ? 'Creating account…' : 'Create Account'}
              {!loading && <ArrowRight size={16} />}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground mt-5">
            Already have an account?{' '}
            <button onClick={() => router.push('/login')} className="text-primary font-medium hover:underline">Sign in</button>
          </p>
        </div>
      </div>
    </div>
  )
}
