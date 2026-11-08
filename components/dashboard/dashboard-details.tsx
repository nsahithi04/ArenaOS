'use client'

// Drill-down popups for the dashboard: every figure opens the records behind it,
// with a plain-language explanation of how the number is calculated.

import { useEffect, useState } from 'react'
import {
  api, ApiError, ErrorState, fmtDate, fmtTime, methodLabel, Modal, money, PaymentBadge, sourceLabel, Spinner, StatusBadge,
  type Booking,
} from '@/components/bookings/shared'

export type CourtRow = { key: string; name: string; bookings: number; bookedHours: number; openHours: number; occupancy: number | null; gross: number | null; collected: number | null }
export type SourceRow = { key: string; name: string; bookings: number; gross: number | null; collected: number | null }

/** What to show. Server-backed kinds fetch /api/dashboard/details; the rest render from metrics already loaded. */
export type DetailSpec =
  | { kind: 'payments' | 'bookings' | 'pending' | 'cancellations'; title: string; explain: React.ReactNode; params: Record<string, string> }
  | { kind: 'occupancy'; title: string; explain: React.ReactNode; courts: CourtRow[] }
  | { kind: 'sources'; title: string; explain: React.ReactNode; sources: SourceRow[] }

type Payment = { id: string; kind: 'PAYMENT' | 'REFUND'; method: string; amount: number; receivedDate: string; receivedMin: number; bookingId: string | null; customer: string; courtName: string; bookingDate: string | null }
type DetailsResponse = { currency: string; truncated: boolean; payments?: Payment[]; bookings?: Booking[] }

const th = 'text-left text-xs font-medium text-muted-foreground px-3 py-2 whitespace-nowrap'
const td = 'px-3 py-2 text-sm whitespace-nowrap'

export function DashboardDetails({ spec, currency, rangeQuery, onClose, onOpenBooking }: {
  spec: DetailSpec
  currency: string
  /** range=…[&from&to] of the dashboard, so details match the cards. */
  rangeQuery: string
  onClose: () => void
  onOpenBooking: (id: string) => void
}) {
  const remote = spec.kind === 'payments' || spec.kind === 'bookings' || spec.kind === 'pending' || spec.kind === 'cancellations'
  const [data, setData] = useState<DetailsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const query = remote ? new URLSearchParams({ kind: spec.kind, ...spec.params }).toString() : ''

  useEffect(() => {
    if (!remote) return
    setData(null)
    setError(null)
    // A specific `date` overrides the dashboard range on the server.
    api<DetailsResponse>(`/api/dashboard/details?${rangeQuery}&${query}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [remote, rangeQuery, query])

  return (
    <Modal title={spec.title} onClose={onClose} width="max-w-3xl">
      <div className="rounded-lg bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground mb-4">{spec.explain}</div>

      {spec.kind === 'occupancy' && <OccupancyTable courts={spec.courts} />}
      {spec.kind === 'sources' && <SourcesTable rows={spec.sources} currency={currency} />}

      {remote && (error ? (
        <ErrorState message={error} />
      ) : !data ? (
        <div className="flex justify-center py-10 text-muted-foreground"><Spinner /></div>
      ) : data.payments ? (
        <PaymentsTable rows={data.payments} currency={currency} onOpenBooking={onOpenBooking} />
      ) : (
        <BookingsTable rows={data.bookings ?? []} currency={currency} onOpenBooking={onOpenBooking} showReason={spec.kind === 'cancellations'} showBalance={spec.kind === 'pending'} />
      ))}
      {data?.truncated && <p className="text-xs text-muted-foreground mt-2">Showing the first 500 records. Narrow the date range to see the rest.</p>}
    </Modal>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground text-center py-8">{text}</p>
}

function PaymentsTable({ rows, currency, onOpenBooking }: { rows: Payment[]; currency: string; onOpenBooking: (id: string) => void }) {
  if (!rows.length) return <Empty text="No payments or refunds recorded in this period." />
  const total = rows.reduce((s, p) => s + (p.kind === 'PAYMENT' ? p.amount : -p.amount), 0)
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full">
        <thead className="bg-muted/40"><tr>{['Received', 'Customer', 'For', 'Method', 'Amount'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id} onClick={() => p.bookingId && onOpenBooking(p.bookingId)} className={`border-t border-border ${p.bookingId ? 'hover:bg-muted/20 cursor-pointer' : ''}`}>
              <td className={td}>{fmtDate(p.receivedDate, { month: 'short', day: 'numeric' })} · {fmtTime(p.receivedMin)}</td>
              <td className={`${td} font-medium`}>{p.customer}</td>
              <td className={`${td} text-muted-foreground`}>{p.courtName}</td>
              <td className={`${td} text-muted-foreground`}>{methodLabel(p.method)}</td>
              <td className={`${td} font-medium ${p.kind === 'REFUND' ? 'text-purple-700' : ''}`}>{p.kind === 'REFUND' ? `−${money(p.amount, currency)} refund` : money(p.amount, currency)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr className="border-t border-border bg-muted/20"><td className={`${td} font-semibold`} colSpan={4}>Net collected</td><td className={`${td} font-semibold`}>{money(Math.round(total * 100) / 100, currency)}</td></tr></tfoot>
      </table>
    </div>
  )
}

function BookingsTable({ rows, currency, onOpenBooking, showReason, showBalance }: {
  rows: Booking[]; currency: string; onOpenBooking: (id: string) => void; showReason?: boolean; showBalance?: boolean
}) {
  if (!rows.length) return <Empty text="No bookings in this period." />
  const total = rows.reduce((s, b) => s + (showBalance ? b.balance : b.amount), 0)
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full">
        <thead className="bg-muted/40">
          <tr>{['Date & time', 'Customer', 'Court', 'Source', showReason ? 'Reason' : 'Status', showBalance ? 'Balance due' : 'Price', 'Payment'].map((h) => <th key={h} className={th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} onClick={() => onOpenBooking(b.id)} className="border-t border-border hover:bg-muted/20 cursor-pointer">
              <td className={td}>{fmtDate(b.date, { weekday: 'short', month: 'short', day: 'numeric' })} · {fmtTime(b.startMin)}</td>
              <td className={`${td} font-medium`}>{b.customer}</td>
              <td className={`${td} text-muted-foreground`}>{b.courtName}</td>
              <td className={`${td} text-muted-foreground`}>{sourceLabel(b.source)}</td>
              <td className={td}>{showReason ? <span className="text-muted-foreground">{b.cancelReason ?? '—'}</span> : <StatusBadge status={b.status} />}</td>
              <td className={`${td} font-medium`}>{money(showBalance ? b.balance : b.amount, currency)}</td>
              <td className={td}><PaymentBadge payment={b.payment} paid={b.paid} balance={b.balance} /></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/20">
            <td className={`${td} font-semibold`} colSpan={5}>{rows.length} booking{rows.length === 1 ? '' : 's'}</td>
            <td className={`${td} font-semibold`} colSpan={2}>{money(Math.round(total * 100) / 100, currency)}{showReason ? ' not played' : ''}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function OccupancyTable({ courts }: { courts: CourtRow[] }) {
  if (!courts.length) return <Empty text="No active courts." />
  const open = courts.reduce((s, c) => s + c.openHours, 0)
  const booked = courts.reduce((s, c) => s + c.bookedHours, 0)
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full">
        <thead className="bg-muted/40"><tr>{['Court', 'Hours open', 'Hours booked', 'Occupancy'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {courts.map((c) => (
            <tr key={c.key} className="border-t border-border">
              <td className={`${td} font-medium`}>{c.name}</td>
              <td className={td}>{c.openHours}h</td>
              <td className={td}>{c.bookedHours}h</td>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className="h-full bg-green-500" style={{ width: `${(c.occupancy ?? 0) * 100}%` }} /></div>
                  {c.occupancy == null ? '—' : `${Math.round(c.occupancy * 100)}%`}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border bg-muted/20">
            <td className={`${td} font-semibold`}>All courts</td>
            <td className={`${td} font-semibold`}>{Math.round(open * 100) / 100}h</td>
            <td className={`${td} font-semibold`}>{Math.round(booked * 100) / 100}h</td>
            <td className={`${td} font-semibold`}>{open ? `${Math.round(Math.min(1, booked / open) * 100)}%` : '—'}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function SourcesTable({ rows, currency }: { rows: SourceRow[]; currency: string }) {
  if (!rows.length) return <Empty text="No bookings in this period." />
  return (
    <div className="overflow-x-auto border border-border rounded-lg">
      <table className="w-full">
        <thead className="bg-muted/40"><tr>{['Source', 'Channel', 'Bookings', 'Booked value', 'Collected'].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-border">
              <td className={`${td} font-medium`}>{sourceLabel(r.key)}</td>
              <td className={`${td} text-muted-foreground`}>{['GAMEON', 'PLAYO', 'DISTRICT'].includes(r.key) ? 'Online' : r.key === 'OTHER' ? 'Other' : 'Offline'}</td>
              <td className={td}>{r.bookings}</td>
              <td className={td}>{money(r.gross, currency)}</td>
              <td className={td}>{money(r.collected, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
