'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { BadgeCheck, Pencil, Plus, Search, Wallet, XCircle } from 'lucide-react'
import {
  api, ApiError, Badge, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, inputCls, METHODS, Modal, money, Spinner, useBookingContext,
  type BookingContext, type PaymentMethod,
} from '@/components/bookings/shared'
import { PlayerPicker, playerPayload, type PlayerChoice } from '@/components/club/player-picker'
import { membershipEndDate } from '@/lib/club/schedule'

type Plan = { id: string; name: string; description: string | null; durationMonths: number; price: number; sportId: string | null; sportName: string | null; isActive: boolean; memberships: number }
type MembershipRow = {
  id: string; playerId: string; playerName: string; phone: string | null; email: string | null; planName: string; sportName: string | null
  startDate: string; endDate: string; state: 'ACTIVE' | 'UPCOMING' | 'EXPIRED' | 'CANCELLED'; price: number; paid: number; balance: number; bookings: number
}
type Tab = 'current' | 'expired' | 'plans'

const STATE: Record<MembershipRow['state'], { label: string; bg: string; color: string }> = {
  ACTIVE: { label: 'Active', bg: '#f0fdf4', color: '#15803d' },
  UPCOMING: { label: 'Starts soon', bg: '#eff6ff', color: '#2563eb' },
  EXPIRED: { label: 'Expired', bg: '#f8fafc', color: '#475569' },
  CANCELLED: { label: 'Cancelled', bg: '#fff5f5', color: '#dc2626' },
}

export const durationLabel = (m: number) => (m % 12 === 0 ? (m === 12 ? '1 year' : `${m / 12} years`) : m === 1 ? '1 month' : `${m} months`)

export function MembersScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [tab, setTab] = useState<Tab>('current')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<MembershipRow[] | null>(null)
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selling, setSelling] = useState(false)
  const [planForm, setPlanForm] = useState<Plan | 'new' | null>(null)
  const [paying, setPaying] = useState<MembershipRow | null>(null)
  const [cancelling, setCancelling] = useState<MembershipRow | null>(null)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (!ctx) return
    api<Plan[]>(`/api/membership-plans?venueId=${ctx.venue.id}`).then(setPlans).catch((e: ApiError) => setError(e.message))
  }, [ctx, refreshKey])

  useEffect(() => {
    if (!ctx || tab === 'plans') return
    setRows(null)
    const t = setTimeout(() => {
      const p = new URLSearchParams({ venueId: ctx.venue.id, status: tab })
      if (q.trim()) p.set('q', q.trim())
      api<{ items: MembershipRow[] }>(`/api/memberships?${p}`).then((d) => setRows(d.items)).catch((e: ApiError) => setError(e.message))
    }, 200)
    return () => clearTimeout(t)
  }, [ctx, tab, q, refreshKey])

  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>
  const cur = ctx.venue.currency
  const canSell = ctx.permissions.canEditBookings
  const canManage = ctx.permissions.canManageVenue
  const activePlans = (plans ?? []).filter((p) => p.isActive)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Members</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Monthly and yearly memberships. Members play free: pick &quot;Member&quot; when booking them.</p>
        </div>
        {canSell && (
          <button onClick={() => setSelling(true)} disabled={!activePlans.length} title={activePlans.length ? undefined : 'Create a plan first'}
            className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50" style={{ background: BRAND_GRADIENT }}>
            <Plus size={14} /> Sell Membership
          </button>
        )}
      </div>

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 bg-white rounded-xl border border-border p-2">
        <div className="flex gap-1 overflow-x-auto">
          {([['current', 'Current'], ['expired', 'Expired & cancelled'], ['plans', 'Plans']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all ${tab === id ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>
              {label}
            </button>
          ))}
        </div>
        {tab !== 'plans' && (
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search members…" className="pl-8 pr-4 py-2 text-sm bg-muted rounded-lg outline-none focus:ring-2 focus:ring-primary/20 w-full md:w-56" />
          </div>
        )}
      </div>

      {error ? <ErrorState message={error} onRetry={() => { setError(null); refresh() }} /> : tab === 'plans' ? (
        <PlansGrid plans={plans} currency={cur} canManage={canManage} onEdit={(p) => setPlanForm(p)} onNew={() => setPlanForm('new')} />
      ) : (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          {!rows ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : rows.length === 0 ? (
            <div className="text-center py-16">
              <BadgeCheck size={30} className="mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">{q ? 'No members match.' : tab === 'current' ? 'No current members yet.' : 'No expired or cancelled memberships.'}</p>
              {tab === 'current' && !q && !plans?.length && canManage && (
                <button onClick={() => { setTab('plans'); setPlanForm('new') }} className="mt-3 text-sm text-primary hover:underline">Create your first plan</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] whitespace-nowrap">
                <thead><tr className="bg-muted/40 border-b border-border">
                  {['Member', 'Plan', 'Valid', 'Status', 'Bookings', 'Paid', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3"><p className="text-sm font-medium">{m.playerName}</p>{m.phone && <p className="text-xs text-muted-foreground">{m.phone}</p>}</td>
                      <td className="px-4 py-3 text-sm">{m.planName}{m.sportName && <span className="text-xs text-muted-foreground"> · {m.sportName}</span>}</td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(m.startDate, { month: 'short', day: 'numeric' })} – {fmtDate(m.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td className="px-4 py-3"><Badge {...STATE[m.state]}>{STATE[m.state].label}</Badge></td>
                      <td className="px-4 py-3 text-sm text-muted-foreground">{m.bookings}</td>
                      <td className="px-4 py-3 text-sm">
                        {money(m.paid, cur)}{m.balance > 0 && m.state !== 'CANCELLED' && <span className="text-xs text-amber-700"> · {money(m.balance, cur)} due</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 justify-end">
                          {canSell && m.balance > 0 && m.state !== 'CANCELLED' && (
                            <button onClick={() => setPaying(m)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50"><Wallet size={12} /> Payment</button>
                          )}
                          {ctx.permissions.canRefund && (m.state === 'ACTIVE' || m.state === 'UPCOMING') && (
                            <button onClick={() => setCancelling(m)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50"><XCircle size={12} /> Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {selling && <SellMembership ctx={ctx} plans={activePlans} onClose={() => setSelling(false)} onDone={() => { setSelling(false); setTab('current'); refresh() }} />}
      {planForm && <PlanForm ctx={ctx} plan={planForm === 'new' ? null : planForm} onClose={() => setPlanForm(null)} onDone={() => { setPlanForm(null); refresh() }} />}
      {paying && <MembershipPayment m={paying} currency={cur} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refresh() }} />}
      {cancelling && (
        <ConfirmDialog
          title={`Cancel ${cancelling.playerName}'s membership?`}
          message={<>Their {cancelling.planName} stops covering bookings immediately. Bookings already made stay; cancel them separately if needed. Payments stay on record.</>}
          confirmLabel="Cancel membership" danger
          onCancel={() => setCancelling(null)}
          onConfirm={async () => {
            try {
              await api(`/api/memberships/${cancelling.id}`, { method: 'PATCH', json: { action: 'cancel' } })
              toast.success('Membership cancelled')
              refresh()
            } catch (e) { toast.error((e as ApiError).message) }
            setCancelling(null)
          }}
        />
      )}
    </div>
  )
}

function PlansGrid({ plans, currency, canManage, onEdit, onNew }: { plans: Plan[] | null; currency: string; canManage: boolean; onEdit: (p: Plan) => void; onNew: () => void }) {
  if (!plans) return <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div>
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
      {plans.map((p) => (
        <div key={p.id} className={`bg-white rounded-xl border border-border p-5 ${p.isActive ? '' : 'opacity-60'}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-foreground">{p.name}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{durationLabel(p.durationMonths)} · {p.sportName ?? 'All sports'}{!p.isActive && ' · Not on sale'}</p>
            </div>
            {canManage && <button onClick={() => onEdit(p)} aria-label={`Edit ${p.name}`} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><Pencil size={13} /></button>}
          </div>
          <p className="text-2xl font-semibold mt-3">{money(p.price, currency)}</p>
          {p.description && <p className="text-sm text-muted-foreground mt-2">{p.description}</p>}
          <p className="text-xs text-muted-foreground mt-3">{p.memberships} active member{p.memberships === 1 ? '' : 's'}</p>
        </div>
      ))}
      {canManage && (
        <button onClick={onNew} className="min-h-40 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary bg-white">
          <Plus size={18} /> New plan
        </button>
      )}
      {!canManage && plans.length === 0 && <p className="text-sm text-muted-foreground">No plans yet. Ask a manager or the owner to create one.</p>}
    </div>
  )
}

function PlanForm({ ctx, plan, onClose, onDone }: { ctx: BookingContext; plan: Plan | null; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(plan?.name ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [months, setMonths] = useState(plan?.durationMonths ?? 1)
  const [price, setPrice] = useState(plan ? String(plan.price) : '')
  const [sportId, setSportId] = useState(plan?.sportId ?? '')
  const [isActive, setIsActive] = useState(plan?.isActive ?? true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) return setError('Name is required')
    if (!(Number(price) >= 0) || price === '') return setError('Enter a price')
    setBusy(true); setError(null)
    const body = { venueId: ctx.venue.id, name, description: description || null, durationMonths: months, price: Number(price), sportId: sportId || null, isActive }
    try {
      if (plan) await api(`/api/membership-plans/${plan.id}`, { method: 'PATCH', json: body })
      else await api('/api/membership-plans', { method: 'POST', json: body })
      toast.success(plan ? 'Plan saved' : 'Plan created')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }

  return (
    <Modal title={plan ? 'Edit plan' : 'New membership plan'} onClose={onClose} width="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Save plan</button>
      </div>}>
      <div className="space-y-3">
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Name *</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Monthly Unlimited" className={inputCls} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Length</label>
            <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className={inputCls}>
              {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Price *</label><input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className={inputCls} /></div>
        </div>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Covers</label>
          <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={inputCls}>
            <option value="">All sports</option>
            {ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.name} only</option>)}
          </select></div>
        <div><label className="block text-xs font-medium text-muted-foreground mb-1">Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} placeholder="Shown to staff when selling" className={inputCls} /></div>
        {plan && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> On sale</label>}
        {plan && <p className="text-xs text-muted-foreground">Changes apply to new sales. Existing members keep the price and dates they bought.</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

function SellMembership({ ctx, plans, onClose, onDone }: { ctx: BookingContext; plans: Plan[]; onClose: () => void; onDone: () => void }) {
  const [player, setPlayer] = useState<PlayerChoice>(null)
  const [planId, setPlanId] = useState(plans[0]?.id ?? '')
  const [startDate, setStartDate] = useState(ctx.today)
  const [takePayment, setTakePayment] = useState(true)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(plans[0] ? String(plans[0].price) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const plan = plans.find((p) => p.id === planId)
  const endDate = useMemo(() => (plan && startDate ? membershipEndDate(startDate, plan.durationMonths) : null), [plan, startDate])

  async function sell() {
    if (!player || (player.kind === 'new' && !player.name.trim())) return setError('Choose a player or enter a name')
    if (!plan) return setError('Choose a plan')
    const n = Number(amount)
    if (takePayment && (!(n > 0) || n > plan.price)) return setError(`Payment must be between 0 and ${money(plan.price, ctx.venue.currency)}`)
    setBusy(true); setError(null)
    try {
      await api('/api/memberships', { method: 'POST', json: { venueId: ctx.venue.id, ...playerPayload(player), planId, startDate, payment: takePayment ? { amount: n, method } : null } })
      toast.success('Membership sold')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Sell membership" onClose={onClose} width="max-w-md"
      footer={<div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{plan ? money(plan.price, ctx.venue.currency) : ''}</span>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={sell} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Sell</button>
        </div>
      </div>}>
      <div className="space-y-4">
        <PlayerPicker ctx={ctx} value={player} onChange={setPlayer} label="Member" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Plan</label>
            <select value={planId} onChange={(e) => { setPlanId(e.target.value); const p = plans.find((x) => x.id === e.target.value); if (p) setAmount(String(p.price)) }} className={inputCls}>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name} · {durationLabel(p.durationMonths)}</option>)}
            </select></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Starts</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
        </div>
        {endDate && <p className="text-sm text-muted-foreground -mt-1">Valid {fmtDate(startDate, { month: 'short', day: 'numeric', year: 'numeric' })} – {fmtDate(endDate, { month: 'short', day: 'numeric', year: 'numeric' })}{plan?.sportName ? ` · ${plan.sportName} only` : ' · all sports'}</p>}
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
    </Modal>
  )
}

function MembershipPayment({ m, currency, onClose, onDone }: { m: MembershipRow; currency: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(m.balance.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function pay() {
    const n = Number(amount)
    if (!(n > 0) || n > m.balance) return setError(`Enter up to ${money(m.balance, currency)}`)
    setBusy(true); setError(null)
    try {
      await api(`/api/memberships/${m.id}/payments`, { method: 'POST', json: { amount: n, method } })
      toast.success('Payment recorded')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Record membership payment" subtitle={`${m.playerName} · ${m.planName}`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={pay} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Record payment</button>
      </div>}>
      <p className="text-sm text-muted-foreground mb-3">Outstanding: <b className="text-foreground">{money(m.balance, currency)}</b></p>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select>
      </div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Modal>
  )
}
