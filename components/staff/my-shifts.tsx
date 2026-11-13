'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Clock, LogIn, LogOut, Wallet } from 'lucide-react'
import { api, ApiError, BRAND_GRADIENT, ErrorState, fmtDate, fmtDuration, fmtTime, money, Spinner } from '@/components/bookings/shared'

type Data = {
  venue: string; currency: string; today: string; name: string; position: string | null; onClockSince: string | null
  shifts: { id: string; date: string; startMin: number; endMin: number; position: string | null; notes: string | null }[]
  entries: { id: string; date: string; inMin: number; outMin: number | null; minutes: number; manual: boolean }[]
  month: { payType: 'HOURLY' | 'MONTHLY' | null; payRate: number | null; workedMinutes: number; scheduledMinutes: number; gross: number | null; paid: number; balance: number | null } | null
  monthRange: { from: string; to: string }
}

function elapsed(since: string) {
  return fmtDuration(Math.max(1, Math.round((Date.now() - Date.parse(since)) / 60000)))
}

/** A team member's own view: upcoming shifts, clock in/out, hours and pay this month. */
export function MyShifts() {
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)
  const load = useCallback(() => { api<Data>('/api/me/shifts').then(setD).catch((e: ApiError) => setError(e.message)) }, [])
  useEffect(load, [load])
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t) }, [])

  async function clock(action: 'in' | 'out') {
    setBusy(true)
    try { await api('/api/me/clock', { method: 'POST', json: { action } }); toast.success(action === 'in' ? 'Clocked in' : 'Clocked out'); load() }
    catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false) }
  }

  if (error) return <div className="p-6"><ErrorState message={error} onRetry={load} /></div>
  if (!d) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  const today = d.shifts.filter((s) => s.date === d.today)
  const m = d.month

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">My Shifts</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{d.name}{d.position ? ` · ${d.position}` : ''} · {d.venue}</p>
      </div>

      <div className="bg-white rounded-xl border border-border p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          {d.onClockSince ? (
            <>
              <p className="text-sm text-green-700 font-medium flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse" /> On the clock</p>
              <p className="text-2xl font-semibold mt-1">{elapsed(d.onClockSince)}</p>
              <p className="text-xs text-muted-foreground">since {new Date(d.onClockSince).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">You&apos;re not clocked in</p>
              <p className="text-base font-medium mt-1">{today.length ? `Today: ${today.map((s) => `${fmtTime(s.startMin)}–${fmtTime(s.endMin)}`).join(', ')}` : 'No shift today'}</p>
            </>
          )}
        </div>
        <button onClick={() => clock(d.onClockSince ? 'out' : 'in')} disabled={busy}
          className={`flex items-center justify-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white disabled:opacity-60 ${d.onClockSince ? 'bg-slate-700 hover:bg-slate-800' : ''}`}
          style={d.onClockSince ? undefined : { background: BRAND_GRADIENT }}>
          {busy ? <Spinner /> : d.onClockSince ? <LogOut size={16} /> : <LogIn size={16} />} {d.onClockSince ? 'Clock out' : 'Clock in'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-border px-4 py-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><Clock size={12} /> Worked this month</p><p className="text-lg font-semibold">{fmtDuration(m?.workedMinutes ?? 0) || '0h'}</p><p className="text-[11px] text-muted-foreground">{fmtDuration(m?.scheduledMinutes ?? 0) || '0h'} scheduled</p></div>
        <div className="bg-white rounded-xl border border-border px-4 py-3"><p className="text-xs text-muted-foreground flex items-center gap-1"><Wallet size={12} /> Earned this month</p><p className="text-lg font-semibold">{m?.payType ? money(m.gross, d.currency) : '—'}</p><p className="text-[11px] text-muted-foreground">{m?.payType === 'HOURLY' ? `${money(m.payRate, d.currency)}/hr` : m?.payType === 'MONTHLY' ? `${money(m.payRate, d.currency)}/month` : 'Pay not set up yet'}</p></div>
        <div className="bg-white rounded-xl border border-border px-4 py-3"><p className="text-xs text-muted-foreground">Paid this month</p><p className="text-lg font-semibold text-green-700">{money(m?.paid ?? 0, d.currency)}</p>{m?.balance != null && m.balance > 0 && <p className="text-[11px] text-amber-700">{money(m.balance, d.currency)} still to be paid</p>}</div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <p className="px-5 py-3 border-b border-border font-medium flex items-center gap-2"><CalendarClock size={16} /> Upcoming shifts</p>
        {d.shifts.length === 0 ? <p className="text-sm text-muted-foreground text-center py-10">No upcoming shifts published yet.</p> : (
          <ul className="divide-y divide-border">
            {d.shifts.map((s) => (
              <li key={s.id} className={`px-5 py-3 flex items-center justify-between gap-3 ${s.date === d.today ? 'bg-green-50/40' : ''}`}>
                <div>
                  <p className="text-sm font-medium">{s.date === d.today ? 'Today' : fmtDate(s.date, { weekday: 'long', month: 'short', day: 'numeric' })}</p>
                  <p className="text-xs text-muted-foreground">{[s.position, s.notes].filter(Boolean).join(' · ') || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold">{fmtTime(s.startMin)} – {fmtTime(s.endMin)}</p>
                  <p className="text-xs text-muted-foreground">{fmtDuration(s.endMin - s.startMin)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <p className="px-5 py-3 border-b border-border font-medium">Recent hours</p>
        {d.entries.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">No time recorded in the last two weeks.</p> : (
          <ul className="divide-y divide-border">
            {d.entries.map((e) => (
              <li key={e.id} className="px-5 py-2.5 flex items-center justify-between text-sm">
                <span>{fmtDate(e.date)} · {fmtTime(e.inMin)} – {e.outMin != null ? fmtTime(e.outMin) : 'now'}{e.manual && <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">edited by manager</span>}</span>
                <span className="font-medium">{fmtDuration(e.minutes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
