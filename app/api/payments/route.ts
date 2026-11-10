import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { handleError, requireVenue } from '@/lib/booking/route-helpers'
import { ledgerSelect, ledgerTotals, ledgerWhere, parseLedgerFilters, toLedgerDTO } from '@/lib/payments/service'

// GET /api/payments?venueId&from&to&type&method&kind&q&sort=date|amount&order&page&pageSize&format=csv
// Every payment and refund as its own row, across bookings, memberships, classes and tournaments.
// Owners and managers only (billing:view).
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams
  const ctx = await requireVenue(sp.get('venueId'), 'billing', 'view')
  if (ctx instanceof Response) return ctx
  try {
    const venue = await prisma.venue.findUniqueOrThrow({ where: { id: ctx.access.venueId }, select: { timezone: true, currency: true } })
    const f = parseLedgerFilters(sp)
    const where = ledgerWhere(ctx.access.venueId, venue.timezone, f)
    const csv = sp.get('format') === 'csv'
    const pageSize = csv ? 10_000 : Math.min(Math.max(Number(sp.get('pageSize')) || 25, 1), 100)
    const page = csv ? 1 : Math.max(Number(sp.get('page')) || 1, 1)
    const orderBy = f.sort === 'amount' ? [{ amount: f.order }, { receivedAt: 'desc' as const }] : [{ receivedAt: f.order }, { id: 'asc' as const }]
    const [rows, totals] = await Promise.all([
      prisma.payment.findMany({ where, select: ledgerSelect, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
      ledgerTotals(prisma, where),
    ])
    const items = rows.map((p) => toLedgerDTO(p, venue.timezone))
    if (csv) return toCsv(items)
    return NextResponse.json({ items, totals, page, pageSize, currency: venue.currency })
  } catch (err) {
    return handleError(err, 'payments GET')
  }
}

function cell(v: unknown) {
  let s = v == null ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function toCsv(items: ReturnType<typeof toLedgerDTO>[]) {
  const head = ['Date', 'Time', 'Payer', 'Type', 'For', 'Kind', 'Method', 'Amount', 'Note', 'Recorded by']
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const lines = [head.join(','), ...items.map((p) => [p.date, hhmm(p.minutes), p.payer, p.type, p.detail, p.kind, p.method, p.signedAmount.toFixed(2), p.note, p.recordedBy].map(cell).join(','))]
  return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="payments.csv"', 'Cache-Control': 'no-store' } })
}
