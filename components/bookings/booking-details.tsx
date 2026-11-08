'use client'

// Booking details with actions: edit, reschedule, check in, complete,
// cancel (confirmed), reinstate, record payment / refund.

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, CheckCircle2, Lock, Pencil, RotateCcw, UserCheck, Wallet, XCircle } from 'lucide-react'
import {
  api, ApiError, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, fmtDuration, fmtTime, inputCls, METHODS, methodLabel, Modal, money,
  PaymentBadge, sourceLabel, Spinner, StatusBadge, bookingLockReason, canCheckInToday,
  type BookingContext, type BookingDetail, type BookingStatus, type PaymentMethod,
} from './shared'
import { BookingForm, type BookingFormMode } from './booking-form'

export function BookingDetails({ ctx, bookingId, onClose, onChanged }: {
  ctx: BookingContext
  bookingId: string
  onClose: () => void
  onChanged: () => void
}) {
  const [b, setB] = useState<BookingDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState<BookingFormMode | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [payKind, setPayKind] = useState<'PAYMENT' | 'REFUND' | null>(null)

  const load = useCallback(() => {
    setError(null)
    api<BookingDetail>(`/api/bookings/${bookingId}`).then(setB).catch((e: ApiError) => setError(e.message))
  }, [bookingId])
  useEffect(load, [load])

  const canEdit = ctx.permissions.canEditBookings
  const currency = b?.currency ?? ctx.venue.currency

  async function setStatus(status: BookingStatus, extra: Record<string, unknown> = {}, msg = 'Booking updated') {
    setBusy(status)
    try {
      const updated = await api<BookingDetail>(`/api/bookings/${bookingId}`, { method: 'PATCH', json: { status, ...extra } })
      setB(updated)
      toast.success(msg)
      onChanged()
    } catch (e) {
      toast.error((e as ApiError).message)
    } finally {
      setBusy(null)
      setConfirmCancel(false)
    }
  }

  if (form && b) {
    return (
      <BookingForm
        ctx={ctx}
        mode={form}
        booking={b}
        onClose={() => setForm(null)}
        onSaved={() => { setForm(null); load(); onChanged() }}
      />
    )
  }

  const net = b ? b.paid - b.refunded : 0
  const active = b && b.status !== 'CANCELLED'
  const lockReason = b ? bookingLockReason(ctx, b.date) : null
  const editable = canEdit && !lockReason
  const checkInToday = b ? canCheckInToday(ctx, b.date) : false

  return (
    <>
      <Modal
        title="Booking Details"
        subtitle={b ? `#${b.ref}` : undefined}
        onClose={onClose}
        width="max-w-md"
        footer={
          b && canEdit && (editable || (active && b.balance > 0)) ? (
            <div className="flex flex-wrap gap-2">
              {/* Locked bookings only allow collecting money that's still owed */}
              {!editable && active && b.balance > 0 && <ActionBtn icon={Wallet} onClick={() => setPayKind('PAYMENT')}>Record payment</ActionBtn>}
              {editable && checkInToday && (b.status === 'CONFIRMED' || b.status === 'PENDING') && (
                <ActionBtn primary icon={UserCheck} busy={busy === 'CHECKED_IN'} onClick={() => setStatus('CHECKED_IN', {}, 'Checked in')}>Check in</ActionBtn>
              )}
              {editable && b.status === 'PENDING' && <ActionBtn icon={CheckCircle2} busy={busy === 'CONFIRMED'} onClick={() => setStatus('CONFIRMED', {}, 'Booking confirmed')}>Confirm</ActionBtn>}
              {editable && b.status === 'CHECKED_IN' && <ActionBtn primary icon={CheckCircle2} busy={busy === 'COMPLETED'} onClick={() => setStatus('COMPLETED', {}, 'Marked completed')}>Complete</ActionBtn>}
              {editable && (b.status === 'CONFIRMED' || b.status === 'PENDING' || b.status === 'CHECKED_IN') && (
                <ActionBtn icon={CalendarClock} onClick={() => setForm('reschedule')}>Reschedule</ActionBtn>
              )}
              {editable && b.status !== 'COMPLETED' && <ActionBtn icon={Pencil} onClick={() => setForm('edit')}>Edit</ActionBtn>}
              {editable && active && b.balance > 0 && <ActionBtn icon={Wallet} onClick={() => setPayKind('PAYMENT')}>Record payment</ActionBtn>}
              {editable && ctx.permissions.canRefund && net > 0 && <ActionBtn icon={RotateCcw} onClick={() => setPayKind('REFUND')}>Refund</ActionBtn>}
              {editable && b.status === 'CANCELLED' && <ActionBtn icon={RotateCcw} busy={busy === 'CONFIRMED'} onClick={() => setStatus('CONFIRMED', {}, 'Booking reinstated')}>Reinstate</ActionBtn>}
              {editable && active && b.status !== 'COMPLETED' && <ActionBtn danger icon={XCircle} onClick={() => setConfirmCancel(true)}>Cancel booking</ActionBtn>}
            </div>
          ) : undefined
        }
      >
        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !b ? (
          <div className="flex justify-center py-10 text-muted-foreground"><Spinner /></div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl">{b.sportEmoji ?? '🏟️'}</div>
              <div className="min-w-0">
                <p className="font-medium text-foreground truncate">{b.customer}</p>
                <div className="flex gap-1.5 mt-0.5 flex-wrap">
                  <StatusBadge status={b.status} />
                  <PaymentBadge payment={b.payment} paid={b.paid} balance={b.balance} />
                  <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">{sourceLabel(b.source)}</span>
                  {b.membershipPlan && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-50 text-purple-700">Member · {b.membershipPlan}</span>}
                </div>
              </div>
            </div>

            <dl className="text-sm">
              {[
                ['Court', b.courtName],
                ['Sport', b.sportName ?? '—'],
                ['Date', fmtDate(b.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })],
                ['Time', `${fmtTime(b.startMin)} – ${fmtTime(b.endMin)} (${fmtDuration(b.durationMin)})`],
                ...(b.phone ? [['Phone', b.phone]] : []),
                ...(b.email ? [['Email', b.email]] : []),
                ...(b.notes ? [['Notes', b.notes]] : []),
                ...(b.cancelReason ? [['Cancel reason', b.cancelReason]] : []),
                ...(b.createdByName ? [['Created by', b.createdByName]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2 border-b border-border last:border-0">
                  <dt className="text-muted-foreground flex-shrink-0">{k}</dt>
                  <dd className="font-medium text-foreground text-right break-words min-w-0">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
              <Row k={`Price${b.priceOverridden ? ' (manual)' : ''}`} v={b.membershipPlan ? `Covered by ${b.membershipPlan}` : money(b.amount, currency)} />
              <Row k="Paid" v={money(b.paid, currency)} />
              {b.refunded > 0 && <Row k="Refunded" v={`−${money(b.refunded, currency)}`} />}
              {active && <Row k="Balance due" v={money(b.balance, currency)} strong={b.balance > 0} />}
            </div>

            {b.paymentHistory.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Payments</p>
                <ul className="space-y-1.5 text-sm">
                  {b.paymentHistory.map((p) => (
                    <li key={p.id} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">
                        {new Date(p.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: b.timezone })} · {methodLabel(p.method)}
                        {p.note && !p.note.startsWith('Backfilled') ? ` · ${p.note}` : ''}
                      </span>
                      <span className={p.kind === 'REFUND' ? 'text-purple-700 font-medium' : 'font-medium'}>
                        {p.kind === 'REFUND' ? '−' : ''}{money(p.amount, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {!canEdit && <p className="text-xs text-muted-foreground">You have view-only access to bookings.</p>}
            {canEdit && lockReason && (
              <div className="rounded-lg bg-slate-50 border border-slate-200 text-slate-700 text-xs px-3 py-2 flex items-start gap-2">
                <Lock size={13} className="mt-0.5 flex-shrink-0" /> <span>{lockReason}{active && b.balance > 0 ? ' You can still record a payment that is owed.' : ''}</span>
              </div>
            )}
            {editable && !checkInToday && (b.status === 'CONFIRMED' || b.status === 'PENDING') && (
              <p className="text-xs text-muted-foreground">Check-in opens on the day of the booking.</p>
            )}
          </div>
        )}
      </Modal>

      {confirmCancel && b && (
        <ConfirmDialog
          title="Cancel this booking?"
          message={
            <>
              {b.customer} · {b.courtName} · {fmtDate(b.date)} {fmtTime(b.startMin)}. The slot becomes available immediately.
              {net > 0 && <span className="block mt-2 text-amber-700">{money(net, currency)} has been paid. Record a refund separately if you're returning it.</span>}
            </>
          }
          confirmLabel="Cancel booking"
          danger
          busy={busy === 'CANCELLED'}
          onCancel={() => setConfirmCancel(false)}
          onConfirm={() => setStatus('CANCELLED', { cancelReason: cancelReason || null }, 'Booking cancelled')}
        >
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" className={`${inputCls} mt-3`} />
        </ConfirmDialog>
      )}

      {payKind && b && (
        <PaymentDialog
          kind={payKind}
          booking={b}
          currency={currency}
          onClose={() => setPayKind(null)}
          onDone={() => { setPayKind(null); load(); onChanged() }}
        />
      )}
    </>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{k}</span>
      <span className={strong ? 'font-semibold text-amber-700' : 'font-medium text-foreground'}>{v}</span>
    </div>
  )
}

function ActionBtn({ children, icon: Icon, onClick, primary, danger, busy }: {
  children: React.ReactNode
  icon: React.ElementType
  onClick: () => void
  primary?: boolean
  danger?: boolean
  busy?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all disabled:opacity-60 ${
        primary ? 'text-white hover:opacity-90' : danger ? 'text-red-600 border border-red-200 hover:bg-red-50' : 'border border-border text-foreground hover:bg-muted'
      }`}
      style={primary ? { background: BRAND_GRADIENT } : undefined}
    >
      {busy ? <Spinner /> : <Icon size={13} />} {children}
    </button>
  )
}

function PaymentDialog({ kind, booking, currency, onClose, onDone }: {
  kind: 'PAYMENT' | 'REFUND'
  booking: BookingDetail
  currency: string
  onClose: () => void
  onDone: () => void
}) {
  const max = kind === 'PAYMENT' ? booking.balance : booking.paid - booking.refunded
  const [amount, setAmount] = useState(max.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const n = Number(amount)
    if (!Number.isFinite(n) || n <= 0) return setError('Enter an amount greater than 0')
    if (n > max + 0.001) return setError(`Maximum is ${money(max, currency)}`)
    setBusy(true)
    setError(null)
    try {
      await api(`/api/bookings/${booking.id}/payments`, { method: 'POST', json: { kind, method, amount: n, note: note || null } })
      toast.success(kind === 'PAYMENT' ? 'Payment recorded' : 'Refund recorded')
      onDone()
    } catch (e) {
      setError((e as ApiError).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={kind === 'PAYMENT' ? 'Record payment' : 'Record refund'}
      subtitle={`${booking.customer} · #${booking.ref}`}
      onClose={onClose}
      width="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: kind === 'REFUND' ? '#7c3aed' : BRAND_GRADIENT }}>
            {busy && <Spinner />} {kind === 'PAYMENT' ? 'Record payment' : 'Record refund'}
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">{kind === 'PAYMENT' ? 'Outstanding' : 'Refundable'}: <span className="font-medium text-foreground">{money(max, currency)}</span></p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Amount</label>
            <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Method</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>
              {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Reference / note (optional)" className={inputCls} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
