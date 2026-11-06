'use client'

// Client-side helpers shared by the Bookings, Calendar and Dashboard screens.

import { useCallback, useEffect, useState } from 'react'

// ─── Types mirrored from the API ────────────────────────────────────────────

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'CHECKED_IN' | 'COMPLETED' | 'CANCELLED'
export type PaymentStatus = 'PENDING' | 'PAID' | 'REFUNDED'
export type BookingSource = 'WALK_IN' | 'PHONE' | 'WHATSAPP' | 'GAMEON' | 'PLAYO' | 'DISTRICT' | 'OTHER'
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'ONLINE' | 'OTHER'

export type Booking = {
  id: string
  ref: string
  customer: string
  phone: string | null
  email: string | null
  courtId: string
  courtName: string
  sportId: string | null
  sportName: string | null
  sportEmoji: string | null
  source: BookingSource
  status: BookingStatus
  payment: PaymentStatus
  start: string
  end: string
  date: string
  startMin: number
  endMin: number
  durationMin: number
  amount: number
  paid: number
  refunded: number
  balance: number
  priceOverridden: boolean
  notes: string | null
  cancelledAt: string | null
  cancelReason: string | null
  createdAt: string
}

export type BookingDetail = Booking & {
  currency: string
  timezone: string
  createdByName: string | null
  paymentHistory: { id: string; kind: 'PAYMENT' | 'REFUND'; method: PaymentMethod; amount: number; receivedAt: string; note: string | null; recordedByName: string | null }[]
}

export type CourtBlock = { id: string; courtId: string; reason: string | null; start: string; end: string; date: string; startMin: number; endMin: number }

export type HoursRow = { sportId: string | null; day: string; openTime: string; closeTime: string; isClosed: boolean }

export type BookingContext = {
  venue: { id: string; name: string; timezone: string; currency: string }
  today: string
  courts: { id: string; name: string; sportId: string | null; isActive: boolean; isAvailable: boolean; type: string }[]
  sports: { id: string; name: string; emoji: string | null }[]
  hours: HoursRow[]
  permissions: { isOwner: boolean; canEditBookings: boolean; canRefund: boolean; canViewReports: boolean }
}

// ─── Labels & colours (match the existing GameOn screens) ───────────────────

export const STATUS: Record<BookingStatus, { label: string; bg: string; color: string; border: string }> = {
  PENDING: { label: 'Pending', bg: '#fffbeb', color: '#b45309', border: '#fcd34d' },
  CONFIRMED: { label: 'Confirmed', bg: '#eff6ff', color: '#2563eb', border: '#93c5fd' },
  CHECKED_IN: { label: 'Checked In', bg: '#f0fdf4', color: '#16a34a', border: '#86efac' },
  COMPLETED: { label: 'Completed', bg: '#f5f3ff', color: '#5b21b6', border: '#c4b5fd' },
  CANCELLED: { label: 'Cancelled', bg: '#fff5f5', color: '#dc2626', border: '#fca5a5' },
}

export const PAYMENT: Record<PaymentStatus, { label: string; bg: string; color: string }> = {
  PAID: { label: 'Paid', bg: '#f0fdf4', color: '#15803d' },
  PENDING: { label: 'Unpaid', bg: '#fffbeb', color: '#b45309' },
  REFUNDED: { label: 'Refunded', bg: '#faf5ff', color: '#7c3aed' },
}

export const SOURCES: { value: BookingSource; label: string; online: boolean }[] = [
  { value: 'WALK_IN', label: 'Walk-in', online: false },
  { value: 'PHONE', label: 'Phone', online: false },
  { value: 'WHATSAPP', label: 'WhatsApp', online: false },
  { value: 'GAMEON', label: 'GameOn', online: true },
  { value: 'PLAYO', label: 'Playo', online: true },
  { value: 'DISTRICT', label: 'District', online: true },
  { value: 'OTHER', label: 'Other', online: false },
]
export const sourceLabel = (s: string) => SOURCES.find((x) => x.value === s)?.label ?? s

export const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Card' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'ONLINE', label: 'Online / aggregator' },
  { value: 'OTHER', label: 'Other' },
]
export const methodLabel = (m: string) => METHODS.find((x) => x.value === m)?.label ?? m

export const BRAND_GRADIENT = 'linear-gradient(135deg, #16a34a, #15803d)'
export const inputCls =
  'w-full px-3 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 disabled:bg-muted disabled:text-muted-foreground'

// ─── Formatting ─────────────────────────────────────────────────────────────

export function money(amount: number | null | undefined, currency: string, opts?: { compact?: boolean }) {
  if (amount == null) return '—'
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: opts?.compact ? 0 : 2,
      minimumFractionDigits: opts?.compact ? 0 : 2,
      notation: opts?.compact && Math.abs(amount) >= 10000 ? 'compact' : 'standard',
    }).format(amount)
  } catch {
    return `${currency} ${amount.toFixed(2)}`
  }
}

export function fmtTime(min: number) {
  const h24 = Math.floor(min / 60) % 24
  const m = min % 60
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h24 < 12 ? 'AM' : 'PM'}`
}

export function hhmm(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function parseHHmm(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s)
  return m ? +m[1] * 60 + +m[2] : null
}

export function fmtDate(localDate: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }) {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}

export function fmtDuration(min: number) {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}

export function addDays(localDate: string, n: number) {
  const [y, m, d] = localDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

export function weekStart(localDate: string) {
  const [y, m, d] = localDate.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return addDays(localDate, -((dow + 6) % 7))
}

export function dayName(localDate: string) {
  const [y, m, d] = localDate.split('-').map(Number)
  return ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
}

/** Current minutes-since-midnight in the venue timezone. */
export function nowMinutesIn(tz: string) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date())
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0)
  const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0)
  return (h % 24) * 60 + m
}

export function clockToMin(s: string, isClose = false): number | null {
  const t = s.trim().toUpperCase()
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/.exec(t)
  let v: number | null = null
  if (m) {
    let h = +m[1]
    if (m[3] === 'AM' && h === 12) h = 0
    if (m[3] === 'PM' && h !== 12) h += 12
    v = h * 60 + +m[2]
  } else {
    const n = /^(\d{1,2}):(\d{2})$/.exec(t)
    if (n) v = +n[1] * 60 + +n[2]
  }
  return isClose && v === 0 ? 1440 : v
}

// ─── API ────────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public fields?: Record<string, string>) {
    super(message)
  }
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.json !== undefined && { 'Content-Type': 'application/json' }), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON */
  }
  if (!res.ok) {
    const d = (data ?? {}) as { error?: string; code?: string; fields?: Record<string, string> }
    throw new ApiError(d.error ?? `Request failed (${res.status})`, res.status, d.code, d.fields)
  }
  return data as T
}

export function useBookingContext() {
  const [ctx, setCtx] = useState<BookingContext | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    api<BookingContext>('/api/booking-context')
      .then(setCtx)
      .catch((e: ApiError) => setError(e.status === 404 ? 'Set up your venue first to start taking bookings.' : e.message))
      .finally(() => setLoading(false))
  }, [])
  useEffect(load, [load])
  return { ctx, error, loading, reload: load }
}

// ─── Small UI pieces ────────────────────────────────────────────────────────

export function Badge({ bg, color, children }: { bg: string; color: string; children: React.ReactNode }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={{ background: bg, color }}>
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  const s = STATUS[status]
  return <Badge bg={s.bg} color={s.color}>{s.label}</Badge>
}

export function PaymentBadge({ payment, balance, paid }: { payment: PaymentStatus; balance?: number; paid?: number }) {
  if (payment === 'PENDING' && paid && paid > 0 && balance && balance > 0) return <Badge bg="#fff7ed" color="#c2410c">Part paid</Badge>
  const p = PAYMENT[payment]
  return <Badge bg={p.bg} color={p.color}>{p.label}</Badge>
}

export function Spinner({ className = '' }: { className?: string }) {
  return <span className={`inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin ${className}`} aria-hidden />
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-12 px-4">
      <p className="text-sm text-red-600 mb-3">{message}</p>
      {onRetry && (
        <button onClick={onRetry} className="px-3 py-1.5 rounded-lg border border-border text-sm hover:bg-muted transition-colors">
          Try again
        </button>
      )}
    </div>
  )
}

export function Modal({ title, subtitle, onClose, children, width = 'max-w-lg', footer }: {
  title: string
  subtitle?: string
  onClose: () => void
  children: React.ReactNode
  width?: string
  footer?: React.ReactNode
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 bg-black/30 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white w-full ${width} rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-5 sm:px-6 pt-5 pb-3 border-b border-border flex-shrink-0">
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground flex-shrink-0">
            ✕
          </button>
        </div>
        <div className="px-5 sm:px-6 py-4 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 sm:px-6 py-3 border-t border-border flex-shrink-0">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel, danger, busy, onConfirm, onCancel, children }: {
  title: string
  message: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      width="max-w-sm"
      footer={
        <div className="flex gap-2 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors">
            Keep it
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all disabled:opacity-60 flex items-center gap-2"
            style={{ background: danger ? '#dc2626' : BRAND_GRADIENT }}
          >
            {busy && <Spinner />} {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="text-sm text-muted-foreground">{message}</div>
      {children}
    </Modal>
  )
}
