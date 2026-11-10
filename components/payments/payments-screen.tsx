'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Download, Mail, RefreshCw, Search, Wallet, X } from 'lucide-react'
import {
  api, ApiError, Badge, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, fmtTime, inputCls, METHODS, methodLabel, Modal, money, Spinner, useBookingContext,
  type BookingContext, type PaymentMethod,
} from '@/components/bookings/shared'
import { BookingDetails } from '@/components/bookings/booking-details'
import { membershipEndDate } from '@/lib/club/schedule'

type PType = 'BOOKING' | 'MEMBERSHIP' | 'CLASS' | 'TOURNAMENT'
type LedgerRow = {
  id: string; kind: 'PAYMENT' | 'REFUND'; method: string; amount: number; signedAmount: number; date: string; minutes: number
  type: PType; payer: string; detail: string; note: string | null; recordedBy: string | null; bookingId: string | null; tournamentId: string | null
}
type Totals = { received: number; refunded: number; net: number; count: number }
type PendingItem = { type: PType; targetId: string; tournamentId: string | null; payer: string; phone: string | null; detail: string; date: string; total: number; paid: number; due: number; note: string | null }
type Renewal = {
  membershipId: string; playerId: string; playerName: string; email: string | null; phone: string | null; planId: string; planName: string; planActive: boolean
  price: number; startDate: string; endDate: string; daysLeft: number; state: 'EXPIRING' | 'EXPIRED'; remindedAt: string | null
}
type Tab = 'ledger' | 'pending' | 'renewals'

export const TYPE_STYLE: Record<PType, { label: string; bg: string; color: string }> = {
  BOOKING: { label: 'Booking', bg: '#f0fdf4', color: '#15803d' },
  MEMBERSHIP: { label: 'Membership', bg: '#f5f3ff', color: '#6d28d9' },
  CLASS: { label: 'Class', bg: '#ecfeff', color: '#0e7490' },
  TOURNAMENT: { label: 'Tournament', bg: '#fffbeb', color: '#b45309' },
}
const TYPES = Object.keys(TYPE_STYLE) as PType[]
const PLURAL: Record<PType, string> = { BOOKING: 'Bookings', MEMBERSHIP: 'Memberships', CLASS: 'Classes', TOURNAMENT: 'Tournaments' }

export function PaymentsScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [tab, setTab] = useState<Tab>('ledger')
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get('tab')
    if (t === 'pending' || t === 'renewals' || t === 'ledger') setTab(t)
  }, [])
  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Payments</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Every payment across bookings, memberships, classes and tournaments, what&apos;s still owed, and memberships to renew.</p>
      </div>
      <div className="flex gap-1 bg-white rounded-xl border border-border p-1 w-fit">
        {([['ledger', 'All payments'], ['pending', 'Pending'], ['renewals', 'Renewals']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => { setTab(k); window.history.replaceState(null, '', `/payments?tab=${k}`) }}
            className={`px-3 py-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'ledger' && <Ledger ctx={ctx} />}
      {tab === 'pending' && <Pending ctx={ctx} />}
      {tab === 'renewals' && <Renewals ctx={ctx} />}
    </div>
  )
}

// ─── All payments ───────────────────────────────────────────────────────────

function Ledger({ ctx }: { ctx: BookingContext }) {
  const router = useRouter()
  const cur = ctx.venue.currency
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [type, setType] = useState('')
  const [method, setMethod] = useState('')
  const [kind, setKind] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [sort, setSort] = useState('date:desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<{ items: LedgerRow[]; totals: Totals; pageSize: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [booking, setBooking] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t) }, [q])
  const query = useMemo(() => {
    const p = new URLSearchParams({ venueId: ctx.venue.id })
    if (dq) p.set('q', dq)
    if (type) p.set('type', type)
    if (method) p.set('method', method)
    if (kind) p.set('kind', kind)
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    const [s, o] = sort.split(':')
    p.set('sort', s); p.set('order', o)
    return p
  }, [ctx.venue.id, dq, type, method, kind, from, to, sort])
  useEffect(() => setPage(1), [query])
  useEffect(() => {
    setLoading(true); setError(null)
    const p = new URLSearchParams(query); p.set('page', String(page)); p.set('pageSize', '25')
    api<{ items: LedgerRow[]; totals: Totals; pageSize: number }>(`/api/payments?${p}`).then(setData).catch((e: ApiError) => setError(e.message)).finally(() => setLoading(false))
  }, [query, page, refreshKey])

  const filtered = !!(dq || type || method || kind || from || to)
  const pages = data ? Math.max(1, Math.ceil(data.totals.count / 25)) : 1
  const exportCsv = () => { const a = document.createElement('a'); const p = new URLSearchParams(query); p.set('format', 'csv'); a.href = `/api/payments?${p}`; a.download = 'payments.csv'; a.click() }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[['Received', data?.totals.received, 'text-foreground'], ['Refunded', data ? (data.totals.refunded ? -data.totals.refunded : 0) : null, 'text-purple-700'], ['Net', data?.totals.net, 'text-green-700'], ['Payments', null, 'text-foreground']].map(([l, v, c], i) => (
          <div key={l as string} className="bg-white rounded-xl border border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">{l as string}{filtered ? ' (filtered)' : ''}</p>
            <p className={`text-lg font-semibold ${c}`}>{i === 3 ? data?.totals.count ?? '—' : money(v as number | null, cur)}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-2 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
        <div className="relative col-span-2">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search payer or note…" className={`${inputCls} pl-8`} />
        </div>
        <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls} aria-label="Type"><option value="">All types</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_STYLE[t].label}</option>)}</select>
        <select value={method} onChange={(e) => setMethod(e.target.value)} className={inputCls} aria-label="Method"><option value="">All methods</option>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        <select value={kind} onChange={(e) => setKind(e.target.value)} className={inputCls} aria-label="Kind"><option value="">Payments & refunds</option><option value="PAYMENT">Payments only</option><option value="REFUND">Refunds only</option></select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} aria-label="From" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} aria-label="To" />
        <div className="flex gap-2">
          <select value={sort} onChange={(e) => setSort(e.target.value)} className={inputCls} aria-label="Sort">
            <option value="date:desc">Newest</option><option value="date:asc">Oldest</option><option value="amount:desc">Largest</option><option value="amount:asc">Smallest</option>
          </select>
          {filtered && <button onClick={() => { setQ(''); setType(''); setMethod(''); setKind(''); setFrom(''); setTo('') }} title="Clear filters" className="px-2 rounded-lg border border-border text-muted-foreground hover:bg-muted"><X size={14} /></button>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden relative">
        {loading && data && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/60 animate-pulse" />}
        <div className="flex justify-end px-3 py-2 border-b border-border">
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted"><Download size={13} /> Export CSV</button>
        </div>
        {error ? <ErrorState message={error} onRetry={() => setRefreshKey((k) => k + 1)} /> : !data ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : data.items.length === 0 ? (
          <div className="text-center py-14"><Wallet size={28} className="mx-auto text-muted-foreground mb-2" /><p className="text-sm text-muted-foreground">{filtered ? 'No payments match these filters.' : 'No payments recorded yet.'}</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] whitespace-nowrap">
              <thead><tr className="bg-muted/40">{['Received', 'Payer', 'For', 'Method', 'Amount', 'Recorded by'].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody>
                {data.items.map((p) => {
                  const link = p.bookingId ? () => setBooking(p.bookingId) : p.tournamentId ? () => router.push(`/tournaments/${p.tournamentId}`) : p.type === 'MEMBERSHIP' ? () => router.push('/members') : () => router.push('/classes')
                  return (
                    <tr key={p.id} onClick={link} className="border-t border-border hover:bg-muted/20 cursor-pointer">
                      <td className="px-4 py-2.5 text-sm">{fmtDate(p.date, { month: 'short', day: 'numeric', year: 'numeric' })} <span className="text-xs text-muted-foreground">{fmtTime(p.minutes)}</span></td>
                      <td className="px-4 py-2.5 text-sm font-medium">{p.payer}</td>
                      <td className="px-4 py-2.5 text-sm"><Badge bg={TYPE_STYLE[p.type].bg} color={TYPE_STYLE[p.type].color}>{TYPE_STYLE[p.type].label}</Badge> <span className="text-muted-foreground ml-1">{p.detail}</span>{p.note && !p.note.startsWith('Backfilled') && <span className="text-xs text-muted-foreground"> · {p.note}</span>}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{methodLabel(p.method)}</td>
                      <td className={`px-4 py-2.5 text-sm font-semibold ${p.kind === 'REFUND' ? 'text-purple-700' : ''}`}>{p.kind === 'REFUND' ? `−${money(p.amount, cur)} refund` : money(p.amount, cur)}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{p.recordedBy ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data && data.totals.count > 25 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>Showing {(page - 1) * 25 + 1}–{Math.min(page * 25, data.totals.count)} of {data.totals.count}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 h-8 rounded-lg hover:bg-muted disabled:opacity-40">Prev</button>
            <span className="px-2 h-8 flex items-center">{page} / {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage(page + 1)} className="px-3 h-8 rounded-lg hover:bg-muted disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
      {booking && <BookingDetails ctx={ctx} bookingId={booking} onClose={() => setBooking(null)} onChanged={() => setRefreshKey((k) => k + 1)} />}
    </div>
  )
}

// ─── Pending ────────────────────────────────────────────────────────────────

function Pending({ ctx }: { ctx: BookingContext }) {
  const cur = ctx.venue.currency
  const [type, setType] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('newest')
  const [data, setData] = useState<{ items: PendingItem[]; totalDue: number; byType: Record<PType, { count: number; due: number }> } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [paying, setPaying] = useState<PendingItem | null>(null)
  const [booking, setBooking] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const load = useCallback(() => {
    const p = new URLSearchParams({ venueId: ctx.venue.id, sort })
    if (type) p.set('type', type)
    if (q.trim()) p.set('q', q.trim())
    api<typeof data>(`/api/payments/pending?${p}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [ctx.venue.id, type, q, sort])
  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load, refreshKey])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <button onClick={() => setType('')} className={`text-left bg-white rounded-xl border px-4 py-3 ${type === '' ? 'border-primary ring-2 ring-primary/10' : 'border-border hover:border-primary/40'}`}>
          <p className="text-xs text-muted-foreground">Total outstanding</p><p className="text-lg font-semibold text-amber-700">{money(data ? Object.values(data.byType).reduce((s, x) => s + x.due, 0) : null, cur)}</p>
        </button>
        {TYPES.map((t) => (
          <button key={t} onClick={() => setType(type === t ? '' : t)} className={`text-left bg-white rounded-xl border px-4 py-3 ${type === t ? 'border-primary ring-2 ring-primary/10' : 'border-border hover:border-primary/40'}`}>
            <p className="text-xs text-muted-foreground">{PLURAL[t]}</p>
            <p className="text-lg font-semibold">{money(data?.byType[t].due ?? null, cur)}</p>
            <p className="text-[11px] text-muted-foreground">{data?.byType[t].count ?? 0} owing</p>
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-border p-2 flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or item…" className={`${inputCls} pl-8`} /></div>
        <select value={sort} onChange={(e) => setSort(e.target.value)} className={`${inputCls} sm:w-48`} aria-label="Sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="due">Largest amount due</option><option value="name">Name A–Z</option></select>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {error ? <ErrorState message={error} onRetry={load} /> : !data ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-14">Nothing outstanding{type ? ` for ${PLURAL[type as PType].toLowerCase()}` : ''}. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] whitespace-nowrap">
              <thead><tr className="bg-muted/40">{['Who', 'For', 'Date', 'Total', 'Paid', 'Due', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={`${i.type}:${i.targetId}`} className="border-t border-border">
                    <td className="px-4 py-2.5"><p className="text-sm font-medium">{i.payer}</p>{i.phone && <p className="text-xs text-muted-foreground">{i.phone}</p>}</td>
                    <td className="px-4 py-2.5 text-sm"><Badge bg={TYPE_STYLE[i.type].bg} color={TYPE_STYLE[i.type].color}>{TYPE_STYLE[i.type].label}</Badge> <span className="text-muted-foreground ml-1">{i.detail.split(' · ').slice(1).join(' · ')}</span>{i.note && <span className="text-xs text-muted-foreground"> · {i.note}</span>}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{fmtDate(i.date, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                    <td className="px-4 py-2.5 text-sm">{money(i.total, cur)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{money(i.paid, cur)}</td>
                    <td className="px-4 py-2.5 text-sm font-semibold text-amber-700">{money(i.due, cur)}</td>
                    <td className="px-4 py-2.5 text-right">
                      {ctx.permissions.canEditBookings && (
                        <button onClick={() => (i.type === 'BOOKING' ? setBooking(i.targetId) : setPaying(i))} className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50"><Wallet size={12} /> Record payment</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {paying && <RecordPayment item={paying} currency={cur} onClose={() => setPaying(null)} onDone={() => { setPaying(null); setRefreshKey((k) => k + 1) }} />}
      {booking && <BookingDetails ctx={ctx} bookingId={booking} onClose={() => { setBooking(null); setRefreshKey((k) => k + 1) }} onChanged={() => setRefreshKey((k) => k + 1)} />}
    </div>
  )
}

function paymentUrl(i: PendingItem) {
  if (i.type === 'MEMBERSHIP') return `/api/memberships/${i.targetId}/payments`
  if (i.type === 'CLASS') return `/api/enrollments/${i.targetId}/payments`
  if (i.type === 'TOURNAMENT') return `/api/tournaments/${i.tournamentId}/entrants/${i.targetId}/payments`
  return `/api/bookings/${i.targetId}/payments`
}

function RecordPayment({ item, currency, onClose, onDone }: { item: PendingItem; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(item.due.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function pay() {
    const n = Number(amount)
    if (!(n > 0)) return setError('Enter an amount greater than 0')
    if (item.type !== 'CLASS' && n > item.due) return setError(`At most ${money(item.due, currency)} is owed`)
    setBusy(true); setError(null)
    try { await api(paymentUrl(item), { method: 'POST', json: { amount: n, method, note: note || null } }); toast.success('Payment recorded'); onDone() }
    catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Record payment" subtitle={`${item.payer} · ${item.detail}`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={pay} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Record payment</button>
      </div>}>
      <p className="text-sm text-muted-foreground mb-3">Total {money(item.total, currency)} · paid {money(item.paid, currency)} · <b className="text-amber-700">due {money(item.due, currency)}</b></p>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Note (optional)" className={`${inputCls} mt-2`} />
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Modal>
  )
}

// ─── Renewals ───────────────────────────────────────────────────────────────

function Renewals({ ctx }: { ctx: BookingContext }) {
  const cur = ctx.venue.currency
  const [within, setWithin] = useState(14)
  const [show, setShow] = useState<'all' | 'EXPIRING' | 'EXPIRED'>('all')
  const [data, setData] = useState<Renewal[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState<Renewal[] | null>(null)
  const [renewing, setRenewing] = useState<Renewal | null>(null)
  const [busy, setBusy] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const canSend = ctx.permissions.canRefund // billing:edit

  useEffect(() => {
    setData(null)
    api<{ items: Renewal[] }>(`/api/memberships/renewals?venueId=${ctx.venue.id}&within=${within}&expired=60`).then((d) => setData(d.items)).catch((e: ApiError) => setError(e.message))
  }, [ctx.venue.id, within, refreshKey])

  const rows = (data ?? []).filter((r) => show === 'all' || r.state === show)
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const chosen = rows.filter((r) => selected.has(r.membershipId))
  const daysText = (d: number) => (d > 1 ? `in ${d} days` : d === 1 ? 'tomorrow' : d === 0 ? 'today' : d === -1 ? 'yesterday' : `${-d} days ago`)

  async function send(list: Renewal[]) {
    setBusy(true)
    try {
      const r = await api<{ sent: string[]; noEmail: string[]; failed: string[] }>('/api/memberships/renewal-reminders', { method: 'POST', json: { venueId: ctx.venue.id, membershipIds: list.map((x) => x.membershipId) } })
      if (r.sent.length) toast.success(`Reminder sent to ${r.sent.length} member${r.sent.length === 1 ? '' : 's'}`)
      if (r.noEmail.length) toast.info(`No email on file for ${r.noEmail.join(', ')}`)
      if (r.failed.length) toast.error(`Couldn't send to ${r.failed.join(', ')}`)
      setSelected(new Set())
      setRefreshKey((k) => k + 1)
    } catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false); setConfirm(null) }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-border p-2 flex flex-col md:flex-row md:items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {([['all', 'All'], ['EXPIRING', 'Expiring soon'], ['EXPIRED', 'Expired, not renewed']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setShow(k)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${show === k ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-muted'}`}>
              {l} <span className="text-xs opacity-80">{(data ?? []).filter((r) => k === 'all' || r.state === k).length}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Ending within</span>
          <select value={within} onChange={(e) => setWithin(Number(e.target.value))} className={`${inputCls} w-auto`} aria-label="Ending within">
            {[7, 14, 30, 60].map((d) => <option key={d} value={d}>{d} days</option>)}
          </select>
          {canSend && (
            <button onClick={() => setConfirm(chosen)} disabled={!chosen.length || busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: BRAND_GRADIENT }}>
              <Mail size={13} /> Email reminder{chosen.length ? ` (${chosen.length})` : 's'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {error ? <ErrorState message={error} /> : !data ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-14">No memberships need renewing right now.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] whitespace-nowrap">
              <thead><tr className="bg-muted/40">
                <th className="px-4 py-2.5 w-8">{canSend && <input type="checkbox" aria-label="Select all" checked={rows.length > 0 && rows.every((r) => selected.has(r.membershipId))} onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.membershipId)) : new Set())} />}</th>
                {['Member', 'Plan', 'Ends', 'Contact', 'Last reminder', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.membershipId} className="border-t border-border">
                    <td className="px-4 py-2.5">{canSend && <input type="checkbox" aria-label={`Select ${r.playerName}`} checked={selected.has(r.membershipId)} onChange={() => toggle(r.membershipId)} />}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{r.playerName}</td>
                    <td className="px-4 py-2.5 text-sm">{r.planName} <span className="text-muted-foreground">· {money(r.price, cur)}</span></td>
                    <td className="px-4 py-2.5 text-sm">
                      {fmtDate(r.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}{' '}
                      <Badge bg={r.state === 'EXPIRED' ? '#fff5f5' : r.daysLeft <= 3 ? '#fffbeb' : '#f8fafc'} color={r.state === 'EXPIRED' ? '#dc2626' : r.daysLeft <= 3 ? '#b45309' : '#475569'}>{r.state === 'EXPIRED' ? `ended ${daysText(r.daysLeft)}` : `ends ${daysText(r.daysLeft)}`}</Badge>
                    </td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{r.email ?? <span className="text-amber-700">No email</span>}{r.phone && <span className="block text-xs">{r.phone}</span>}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{r.remindedAt ? new Date(r.remindedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: ctx.venue.timezone }) : '—'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1 justify-end">
                        {canSend && r.email && <button onClick={() => setConfirm([r])} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50"><Mail size={12} /> Remind</button>}
                        {ctx.permissions.canEditBookings && <button onClick={() => setRenewing(r)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50"><RefreshCw size={12} /> Renew</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Members who have already bought a membership running past this one are left off this list.</p>

      {confirm && (
        <ConfirmDialog title={`Email ${confirm.length} renewal reminder${confirm.length === 1 ? '' : 's'}?`} confirmLabel="Send" busy={busy}
          message={<>An email goes to {confirm.filter((r) => r.email).length} member{confirm.filter((r) => r.email).length === 1 ? '' : 's'} from your venue&apos;s email account.{confirm.some((r) => !r.email) && <> {confirm.filter((r) => !r.email).length} without an email will be skipped.</>}{confirm.some((r) => r.remindedAt) && <> Some were already reminded recently.</>}</>}
          onCancel={() => setConfirm(null)} onConfirm={() => send(confirm)} />
      )}
      {renewing && <RenewDialog ctx={ctx} r={renewing} onClose={() => setRenewing(null)} onDone={() => { setRenewing(null); setRefreshKey((k) => k + 1) }} />}
    </div>
  )
}

function RenewDialog({ ctx, r, onClose, onDone }: { ctx: BookingContext; r: Renewal; onClose: () => void; onDone: () => void }) {
  type Plan = { id: string; name: string; durationMonths: number; price: number; isActive: boolean }
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [planId, setPlanId] = useState(r.planId)
  const dayAfter = new Date(Date.parse(`${r.endDate}T00:00:00Z`) + 86400000).toISOString().slice(0, 10)
  const [startDate, setStartDate] = useState(dayAfter > ctx.today ? dayAfter : ctx.today)
  const [takePayment, setTakePayment] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(String(r.price))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api<Plan[]>(`/api/membership-plans?venueId=${ctx.venue.id}`).then((p) => {
      const active = p.filter((x) => x.isActive)
      setPlans(active)
      if (!active.some((x) => x.id === r.planId) && active[0]) { setPlanId(active[0].id); setAmount(String(active[0].price)) }
    }).catch(() => setPlans([]))
  }, [ctx.venue.id, r.planId])
  const plan = plans?.find((p) => p.id === planId)

  async function save() {
    if (!plan) return setError('Choose a plan')
    setBusy(true); setError(null)
    try {
      await api('/api/memberships', { method: 'POST', json: { venueId: ctx.venue.id, playerId: r.playerId, planId, startDate, payment: takePayment ? { amount: Number(amount), method } : null } })
      toast.success(`${r.playerName} renewed`)
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Renew ${r.playerName}`} subtitle={`Current: ${r.planName} until ${fmtDate(r.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`} onClose={onClose} width="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy || !plan} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Renew</button>
      </div>}>
      {!plans ? <div className="flex justify-center py-6 text-muted-foreground"><Spinner /></div> : plans.length === 0 ? <p className="text-sm text-muted-foreground">No plans are on sale. Add one under Members → Plans.</p> : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <select value={planId} onChange={(e) => { setPlanId(e.target.value); const p = plans.find((x) => x.id === e.target.value); if (p) setAmount(String(p.price)) }} className={inputCls}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
          </div>
          {plan && <p className="text-sm text-muted-foreground">Valid {fmtDate(startDate, { month: 'short', day: 'numeric', year: 'numeric' })} – {fmtDate(membershipEndDate(startDate, plan.durationMonths), { month: 'short', day: 'numeric', year: 'numeric' })} · {money(plan.price, ctx.venue.currency)}</p>}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} /> Record payment now</label>
            {takePayment && (
              <div className="grid grid-cols-2 gap-2">
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}
    </Modal>
  )
}
