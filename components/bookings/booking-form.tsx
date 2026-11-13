'use client'

// One form for creating bookings, walk-ins, editing and rescheduling.
// Price and availability are previewed live via /api/bookings/quote; the
// server re-checks everything inside a locked transaction on submit.

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, BadgeCheck, CheckCircle2, Clock } from 'lucide-react'
import { PlayerPicker, type PlayerChoice } from '@/components/club/player-picker'
import {
  api, ApiError, BRAND_GRADIENT, fieldCls, FormProblems, inputCls, METHODS, Modal, money, SOURCES, Spinner, hhmm, parseHHmm, fmtDuration, fmtTime,
  nowMinutesIn, earliestEditableDate,
  type Booking, type BookingContext, type BookingSource, type PaymentMethod,
} from './shared'

export type BookingFormMode = 'create' | 'walkin' | 'edit' | 'reschedule'

export type BookingFormPrefill = { courtId?: string; date?: string; startMin?: number; durationMin?: number; sportId?: string }

type Quote = {
  amount: number
  uncoveredMinutes: number
  available: boolean
  conflict: string | null
  hours: { ok: boolean; message?: string }
}

const DURATIONS = [30, 45, 60, 90, 120, 150, 180, 240]

export function BookingForm({ ctx, mode, booking, prefill, onClose, onSaved }: {
  ctx: BookingContext
  mode: BookingFormMode
  booking?: Booking | null
  prefill?: BookingFormPrefill
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const tz = ctx.venue.timezone
  const currency = ctx.venue.currency
  const isNew = mode === 'create' || mode === 'walkin'
  const scheduleOnly = mode === 'reschedule'
  const activeCourts = ctx.courts.filter((c) => c.isActive)

  const defaultStart = useMemo(() => {
    if (prefill?.startMin != null) return prefill.startMin
    if (booking) return booking.startMin
    // Walk-ins default to now, rounded down to 15 minutes.
    const now = nowMinutesIn(tz)
    return mode === 'walkin' ? Math.floor(now / 15) * 15 : Math.min(Math.ceil(now / 60) * 60, 23 * 60)
  }, [prefill, booking, mode, tz])

  const initialCourt = booking?.courtId ?? prefill?.courtId ?? activeCourts[0]?.id ?? ''
  const courtSport = (id: string) => ctx.courts.find((c) => c.id === id)?.sportId ?? ''

  const [customer, setCustomer] = useState(booking?.customer ?? (mode === 'walkin' ? '' : ''))
  const [phone, setPhone] = useState(booking?.phone ?? '')
  const [email, setEmail] = useState(booking?.email ?? '')
  const [sportId, setSportId] = useState(booking?.sportId ?? prefill?.sportId ?? courtSport(initialCourt))
  const [courtId, setCourtId] = useState(initialCourt)
  const [date, setDate] = useState(booking?.date ?? prefill?.date ?? ctx.today)
  const [start, setStart] = useState(hhmm(defaultStart))
  const [duration, setDuration] = useState(booking?.durationMin ?? prefill?.durationMin ?? 60)
  const [source, setSource] = useState<BookingSource>(booking?.source ?? (mode === 'walkin' ? 'WALK_IN' : 'PHONE'))
  const [status, setStatus] = useState<'CONFIRMED' | 'PENDING'>('CONFIRMED')
  const [notes, setNotes] = useState(booking?.notes ?? '')
  const [overridePrice, setOverridePrice] = useState(booking?.priceOverridden ?? false)
  const [manualPrice, setManualPrice] = useState(booking ? String(booking.amount) : '')
  const [overrideHours, setOverrideHours] = useState(false)
  const [takePayment, setTakePayment] = useState(mode === 'walkin')
  // Member bookings: court time is covered by the member's membership.
  const [isMember, setIsMember] = useState(false)
  const [member, setMember] = useState<PlayerChoice>(null)
  const memberInfo = member?.kind === 'existing' ? member.player.membership : null
  const coveredBy = isNew ? (isMember && memberInfo ? memberInfo.planName : null) : booking?.membershipPlan ?? null
  const [payMethod, setPayMethod] = useState<PaymentMethod>('CASH')
  const [payAmount, setPayAmount] = useState('')
  const [payAmountTouched, setPayAmountTouched] = useState(false)

  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const startMin = parseHHmm(start)
  const endMin = startMin != null ? startMin + duration : null
  const courtsForSport = activeCourts.filter((c) => !sportId || !c.sportId || c.sportId === sportId)

  // Keep court consistent with the chosen sport.
  useEffect(() => {
    if (courtId && !courtsForSport.some((c) => c.id === courtId)) setCourtId(courtsForSport[0]?.id ?? '')
  }, [sportId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live quote (debounced).
  useEffect(() => {
    if (!courtId || startMin == null || endMin == null || endMin > 1440 || !date) {
      setQuote(null)
      return
    }
    setQuoting(true)
    const t = setTimeout(() => {
      api<Quote>('/api/bookings/quote', {
        method: 'POST',
        json: { venueId: ctx.venue.id, courtId, sportId: sportId || null, date, start: hhmm(startMin), end: hhmm(endMin === 1440 ? 0 : endMin), excludeBookingId: booking?.id },
      })
        .then(setQuote)
        .catch(() => setQuote(null))
        .finally(() => setQuoting(false))
    }, 300)
    return () => clearTimeout(t)
  }, [courtId, sportId, date, startMin, endMin, booking?.id, ctx.venue.id])

  const effectivePrice = coveredBy ? 0 : overridePrice ? Number(manualPrice) : quote?.amount ?? null
  const scheduleChanged = booking ? booking.courtId !== courtId || booking.date !== date || booking.startMin !== startMin || booking.durationMin !== duration : true

  // Walk-ins: default the payment amount to the full price until the user edits it.
  useEffect(() => {
    if (!payAmountTouched && effectivePrice != null && Number.isFinite(effectivePrice)) setPayAmount(effectivePrice.toFixed(2))
  }, [effectivePrice, payAmountTouched])

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}
    if (isNew && isMember && !memberInfo) e.customer = 'Choose a member'
    if (!scheduleOnly && !customer.trim()) e.customer = 'Customer name is required'
    if (!courtId) e.courtId = 'Choose a court'
    if (!date) e.date = 'Choose a date'
    if (startMin == null) e.start = 'Choose a start time'
    else if (endMin! > 1440) e.end = 'Booking cannot run past midnight'
    if (phone && !/^[0-9+()\-.\s]{5,30}$/.test(phone)) e.phone = 'Phone number looks invalid'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = 'Email looks invalid'
    if (overridePrice && (!manualPrice || !Number.isFinite(Number(manualPrice)) || Number(manualPrice) < 0)) e.amount = 'Enter a valid price'
    if (isNew && takePayment) {
      const p = Number(payAmount)
      if (!Number.isFinite(p) || p <= 0) e['initialPayment.amount'] = 'Enter the amount received'
      else if (effectivePrice != null && p > effectivePrice) e['initialPayment.amount'] = 'Cannot exceed the booking price'
    }
    return e
  }

  async function submit() {
    const e = validate()
    setFieldErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    setError(null)
    const window = { date, start: hhmm(startMin!), end: hhmm(endMin === 1440 ? 0 : endMin!) }
    try {
      let id: string
      if (isNew) {
        const res = await api<{ id: string }>('/api/bookings', {
          method: 'POST',
          json: {
            venueId: ctx.venue.id,
            courtId,
            sportId: sportId || null,
            customer,
            phone: phone || null,
            email: email || null,
            source,
            ...window,
            amount: coveredBy ? null : overridePrice ? Number(manualPrice) : null,
            membershipId: isMember && memberInfo ? memberInfo.id : null,
            status,
            notes: notes || null,
            overrideHours,
            initialPayment: takePayment && !coveredBy ? { amount: Number(payAmount), method: payMethod } : null,
          },
        })
        id = res.id
        toast.success(mode === 'walkin' ? 'Walk-in booked' : 'Booking created')
      } else {
        const body: Record<string, unknown> = { overrideHours }
        if (scheduleChanged) Object.assign(body, { courtId, ...window })
        if (!scheduleOnly) {
          Object.assign(body, { customer, phone: phone || null, email: email || null, source, notes: notes || null, sportId: sportId || null })
          if (overridePrice) body.amount = Number(manualPrice)
          else if (booking!.priceOverridden) body.recalculatePrice = true
        }
        await api(`/api/bookings/${booking!.id}`, { method: 'PATCH', json: body })
        id = booking!.id
        toast.success(scheduleOnly ? 'Booking rescheduled' : 'Booking updated')
      }
      onSaved(id)
    } catch (err) {
      const e = err as ApiError
      setError(e.message)
      if (e.fields) setFieldErrors(e.fields)
      if (e.code === 'OUTSIDE_HOURS' || e.code === 'VENUE_CLOSED') setQuote((q) => (q ? { ...q, hours: { ok: false, message: e.message } } : q))
      if (e.code === 'NO_PRICE') setOverridePrice(true)
    } finally {
      setSaving(false)
    }
  }

  const title = { create: 'New Booking', walkin: 'Walk-in Booking', edit: 'Edit Booking', reschedule: 'Reschedule Booking' }[mode]
  const durationOptions = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b)
  const blocked = quote ? !quote.available : false
  const hoursIssue = quote && !quote.hours.ok

  const err = (k: string) => fieldErrors[k] && <p className="text-xs text-red-600 mt-1">{fieldErrors[k]}</p>
  const label = (t: string, req = false) => (
    <label className="block text-xs font-medium text-muted-foreground mb-1">
      {t}
      {req && <span className="text-red-500"> *</span>}
    </label>
  )

  return (
    <Modal
      title={title}
      subtitle={booking ? `#${booking.ref} · ${booking.customer}` : `${ctx.venue.name} · times in ${tz.replace(/_/g, ' ')}`}
      onClose={onClose}
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm min-w-0">
            {quoting ? (
              <span className="text-muted-foreground flex items-center gap-2"><Spinner /> Checking…</span>
            ) : coveredBy ? (
              <span className="font-semibold text-purple-700 flex items-center gap-1.5"><BadgeCheck size={14} /> Covered by membership</span>
            ) : effectivePrice != null && Number.isFinite(effectivePrice) ? (
              <span className="font-semibold text-foreground">{money(effectivePrice, currency)}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">Cancel</button>
            <button
              onClick={submit}
              disabled={saving || (blocked && scheduleChanged) || (!!hoursIssue && !overrideHours && scheduleChanged)}
              className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-50 flex items-center gap-2"
              style={{ background: BRAND_GRADIENT }}
            >
              {saving && <Spinner />}
              {isNew ? 'Create booking' : scheduleOnly ? 'Reschedule' : 'Save changes'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        <FormProblems errors={fieldErrors} message={error} />
        {isNew && (
          <div>
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1 w-fit">
              {[['guest', 'Guest'], ['member', 'Member']].map(([k, t]) => (
                <button key={k} type="button" onClick={() => { setIsMember(k === 'member'); setMember(null) }}
                  className={`px-3 py-1.5 rounded-md text-sm ${isMember === (k === 'member') ? 'bg-white shadow-sm font-medium text-foreground' : 'text-muted-foreground'}`}>{t}</button>
              ))}
            </div>
            {isMember && (
              <div className="mt-3">
                <PlayerPicker ctx={ctx} value={member} membersOnly date={date} allowNew={false} label="Member"
                  onChange={(c) => {
                    setMember(c)
                    if (c?.kind === 'existing') {
                      setCustomer(c.player.name)
                      setPhone(c.player.phone ?? '')
                      setEmail(c.player.email ?? '')
                      if (c.player.membership?.sportId) setSportId(c.player.membership.sportId)
                    }
                  }} />
                {err('customer')}
              </div>
            )}
          </div>
        )}
        {!isNew && coveredBy && (
          <div className="rounded-lg bg-purple-50 border border-purple-200 text-purple-800 text-sm px-3 py-2 flex items-center gap-2">
            <BadgeCheck size={14} /> Member booking, covered by {coveredBy}
          </div>
        )}
        {!scheduleOnly && !(isNew && isMember) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              {label('Customer name', true)}
              <input value={customer} onChange={(e) => setCustomer(e.target.value)} maxLength={120} className={fieldCls(fieldErrors.customer)} aria-invalid={!!fieldErrors.customer} placeholder={mode === 'walkin' ? 'Walk-in customer' : 'Full name'} autoFocus />
              {err('customer')}
            </div>
            <div>
              {label('Phone')}
              <input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" className={fieldCls(fieldErrors.phone)} aria-invalid={!!fieldErrors.phone} placeholder="+1 555 123 4567" />
              {err('phone')}
            </div>
            <div>
              {label('Email')}
              <input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} type="email" className={fieldCls(fieldErrors.email)} aria-invalid={!!fieldErrors.email} placeholder="name@example.com" />
              {err('email')}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {!scheduleOnly && (
            <div>
              {label('Sport')}
              <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={inputCls}>
                <option value="">Any sport</option>
                {ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.emoji ? `${s.emoji} ` : ''}{s.name}</option>)}
              </select>
            </div>
          )}
          <div className={scheduleOnly ? 'sm:col-span-2' : ''}>
            {label('Court', true)}
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)} className={fieldCls(fieldErrors.courtId || (blocked && scheduleChanged))} aria-invalid={!!fieldErrors.courtId}>
              {courtsForSport.length === 0 && <option value="">No courts for this sport</option>}
              {courtsForSport.map((c) => <option key={c.id} value={c.id} disabled={!c.isAvailable}>{c.label}{!c.isAvailable ? ' (unavailable)' : ''}</option>)}
            </select>
            {err('courtId')}
          </div>
          <div>
            {label('Date', true)}
            <input type="date" value={date} min={earliestEditableDate(ctx)} onChange={(e) => setDate(e.target.value)} className={fieldCls(fieldErrors.date)} aria-invalid={!!fieldErrors.date} />
            {err('date')}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              {label('Start', true)}
              <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className={fieldCls(fieldErrors.start || fieldErrors.end || (blocked && scheduleChanged))} aria-invalid={!!(fieldErrors.start || fieldErrors.end)} />
            </div>
            <div>
              {label('Duration', true)}
              <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
                {durationOptions.map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
              </select>
            </div>
          </div>
        </div>
        {(fieldErrors.start || fieldErrors.end) && <p className="text-xs text-red-600 -mt-2">{fieldErrors.start ?? fieldErrors.end}</p>}

        {/* Availability */}
        {startMin != null && endMin != null && (
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm space-y-1.5">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock size={13} /> {fmtTime(startMin)} – {fmtTime(endMin)} · {fmtDuration(duration)}
            </div>
            {quote && scheduleChanged && (
              quote.available ? (
                <div className="flex items-center gap-2 text-green-700"><CheckCircle2 size={13} /> Slot is available</div>
              ) : (
                <div className="flex items-center gap-2 text-red-600"><AlertTriangle size={13} /> {quote.conflict}</div>
              )
            )}
            {hoursIssue && scheduleChanged && (
              <div className="text-amber-700">
                <div className="flex items-center gap-2"><AlertTriangle size={13} /> {quote!.hours.message}</div>
                <label className="flex items-center gap-2 mt-1 text-xs text-foreground">
                  <input type="checkbox" checked={overrideHours} onChange={(e) => setOverrideHours(e.target.checked)} /> Book outside operating hours anyway
                </label>
              </div>
            )}
            {quote && quote.uncoveredMinutes > 0 && !overridePrice && (
              <div className="text-amber-700 flex items-center gap-2"><AlertTriangle size={13} /> No pricing rule covers {quote.uncoveredMinutes} min of this slot. Set the price manually.</div>
            )}
          </div>
        )}

        {!scheduleOnly && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                {label('Booking source', true)}
                <select value={source} onChange={(e) => setSource(e.target.value as BookingSource)} className={inputCls}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}{s.online ? ' (online)' : ''}</option>)}
                </select>
              </div>
              {isNew && (
                <div>
                  {label('Status')}
                  <select value={status} onChange={(e) => setStatus(e.target.value as 'CONFIRMED' | 'PENDING')} className={inputCls}>
                    <option value="CONFIRMED">Confirmed</option>
                    <option value="PENDING">Pending (hold)</option>
                  </select>
                </div>
              )}
            </div>

            {!coveredBy && <div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={overridePrice} onChange={(e) => { setOverridePrice(e.target.checked); if (e.target.checked && !manualPrice && quote) setManualPrice(quote.amount.toFixed(2)) }} />
                Set price manually
                {quote && !overridePrice && <span className="text-muted-foreground">(calculated: {money(quote.amount, currency)})</span>}
              </label>
              {overridePrice && (
                <input type="number" min={0} step="0.01" value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} className={`${fieldCls(fieldErrors.amount)} mt-2 sm:w-40`} placeholder="0.00" />
              )}
              {err('amount')}
              {!isNew && booking && scheduleChanged && booking.priceOverridden && !overridePrice && (
                <p className="text-xs text-muted-foreground mt-1">The manual price will be replaced by the calculated price.</p>
              )}
            </div>}

            {isNew && !coveredBy && (
              <div className="rounded-lg border border-border p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} /> Record payment now
                </label>
                {takePayment && (
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      {label('Method')}
                      <select value={payMethod} onChange={(e) => setPayMethod(e.target.value as PaymentMethod)} className={inputCls}>
                        {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </div>
                    <div>
                      {label('Amount received')}
                      <input type="number" min={0} step="0.01" value={payAmount} onChange={(e) => { setPayAmount(e.target.value); setPayAmountTouched(true) }} className={fieldCls(fieldErrors['initialPayment.amount'])} />
                    </div>
                  </div>
                )}
                {err('initialPayment.amount')}
              </div>
            )}

            <div>
              {label('Notes')}
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} className={inputCls} placeholder="Equipment, special requests…" />
            </div>
          </>
        )}

      </div>
    </Modal>
  )
}
