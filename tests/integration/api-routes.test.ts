// Route-handler tests with a mocked session: tenant isolation, staff permissions,
// PII redaction, dashboard revenue, and calendar/listing freshness.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ userId: null as string | null }))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => (session.userId ? { user: { id: session.userId } } : null)) }))

import * as bookings from '@/app/api/bookings/route'
import * as bookingById from '@/app/api/bookings/[id]/route'
import * as payments from '@/app/api/bookings/[id]/payments/route'
import * as dashboard from '@/app/api/dashboard/route'
import * as courtBlocks from '@/app/api/court-blocks/route'
import { addStaff, DATE, prisma, resetDatabase, seedVenue } from './fixtures'

const enabled = !!process.env.TEST_DB_AVAILABLE
const BASE = 'http://test.local'
const as = (userId: string | null) => { session.userId = userId }
const get = (path: string) => new Request(`${BASE}${path}`)
const post = (path: string, body: unknown) => new Request(`${BASE}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const patch = (path: string, body: unknown) => new Request(`${BASE}${path}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } })
const params = (id: string) => ({ params: Promise.resolve({ id }) })

let A: Awaited<ReturnType<typeof seedVenue>>
let B: Awaited<ReturnType<typeof seedVenue>>
let viewer: { id: string }
let editor: { id: string }
let none: { id: string }

async function createVia(userId: string, venueId: string, courtId: string, o: Record<string, unknown> = {}) {
  as(userId)
  return bookings.POST(post('/api/bookings', { venueId, courtId, customer: 'Priya', phone: '+1 555 0101', email: 'priya@example.com', source: 'PHONE', date: DATE, start: '10:00', end: '11:00', ...o }))
}

describe.skipIf(!enabled)('booking API routes', () => {
  beforeAll(async () => {
    await resetDatabase()
    A = await seedVenue('venuea')
    B = await seedVenue('venueb')
    viewer = await addStaff(A.venue.id, 'viewer', { bookings: 'view', reports: 'none' })
    editor = await addStaff(A.venue.id, 'editor', { bookings: 'edit', reports: 'view', billing: 'none' })
    none = await addStaff(A.venue.id, 'nobody', { bookings: 'none' })
  })
  beforeEach(async () => {
    await prisma.payment.deleteMany()
    await prisma.courtBlock.deleteMany()
    await prisma.booking.deleteMany()
  })
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('requires a session', async () => {
    as(null)
    expect((await bookings.GET(get(`/api/bookings?venueId=${A.venue.id}`))).status).toBe(401)
    expect((await bookings.POST(post('/api/bookings', {}))).status).toBe(400) // validation runs first; no data touched
    const res = await bookings.POST(post('/api/bookings', { courtId: A.court1.id, customer: 'x', source: 'PHONE', date: DATE, start: '10:00', end: '11:00' }))
    expect(res.status).toBe(401)
  })

  it('creates via the API and returns field errors for bad input', async () => {
    const ok = await createVia(A.owner.id, A.venue.id, A.court1.id)
    expect(ok.status).toBe(201)
    const bad = await createVia(A.owner.id, A.venue.id, A.court1.id, { customer: '', end: '09:00' })
    expect(bad.status).toBe(400)
    const body = await bad.json()
    expect(body.fields).toMatchObject({ customer: expect.any(String), end: expect.any(String) })
    const clash = await createVia(A.owner.id, A.venue.id, A.court1.id, { start: '10:30', end: '11:30' })
    expect(clash.status).toBe(409)
    expect((await clash.json()).code).toBe('SLOT_CONFLICT')
  })

  it('isolates venues: no reading, writing or probing another tenant', async () => {
    const res = await createVia(B.owner.id, B.venue.id, B.court1.id)
    const { id: bId } = await res.json()

    as(A.owner.id)
    expect((await bookings.GET(get(`/api/bookings?venueId=${B.venue.id}`))).status).toBe(403)
    expect((await bookingById.GET(get(`/api/bookings/${bId}`), params(bId))).status).toBe(404)
    expect((await bookingById.PATCH(patch(`/api/bookings/${bId}`, { status: 'CANCELLED' }), params(bId))).status).toBe(404)
    expect((await payments.POST(post(`/api/bookings/${bId}/payments`, { method: 'CASH', amount: 5 }), params(bId))).status).toBe(404)
    expect((await dashboard.GET(get(`/api/dashboard?venueId=${B.venue.id}`))).status).toBe(403)
    // Using own venueId but another venue's court
    const cross = await createVia(A.owner.id, A.venue.id, B.court1.id)
    expect(cross.status).toBe(404)
    // Default venue resolution only returns the caller's own bookings
    const list = await (await bookings.GET(get('/api/bookings'))).json()
    expect(list.items.every((b: { courtId: string }) => b.courtId !== B.court1.id)).toBe(true)
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bId } })).status).toBe('CONFIRMED')
  })

  it('enforces staff permissions server-side', async () => {
    const created = await (await createVia(A.owner.id, A.venue.id, A.court1.id)).json()

    // bookings:none → nothing
    as(none.id)
    expect((await bookings.GET(get(`/api/bookings?venueId=${A.venue.id}`))).status).toBe(403)

    // bookings:view → can list, cannot create/cancel, and sees no contact details
    as(viewer.id)
    const list = await (await bookings.GET(get(`/api/bookings?venueId=${A.venue.id}`))).json()
    expect(list.items).toHaveLength(1)
    expect(list.items[0]).toMatchObject({ customer: 'Priya', phone: null, email: null })
    expect((await createVia(viewer.id, A.venue.id, A.court2.id)).status).toBe(403)
    as(viewer.id)
    expect((await bookingById.PATCH(patch(`/api/bookings/${created.id}`, { status: 'CANCELLED' }), params(created.id))).status).toBe(403)
    // Searching by phone must not work for viewers (would leak contact data)
    const byPhone = await (await bookings.GET(get(`/api/bookings?venueId=${A.venue.id}&q=0101`))).json()
    expect(byPhone.items).toHaveLength(0)
    // No revenue on the dashboard without reports:view
    const dash = await (await dashboard.GET(get(`/api/dashboard?venueId=${A.venue.id}&range=custom&from=${DATE}&to=${DATE}`))).json()
    expect(dash.canSeeRevenue).toBe(false)
    expect(dash.current.gross).toBeNull()
    expect(dash.current.bookings).toBe(1)

    // bookings:edit → full booking access but no refunds without billing:edit
    as(editor.id)
    const full = await (await bookingById.GET(get(`/api/bookings/${created.id}`), params(created.id))).json()
    expect(full.phone).toBe('+1 555 0101')
    expect((await payments.POST(post(`/api/bookings/${created.id}/payments`, { method: 'CASH', amount: 20 }), params(created.id))).status).toBe(201)
    const refund = await payments.POST(post(`/api/bookings/${created.id}/payments`, { kind: 'REFUND', method: 'CASH', amount: 5 }), params(created.id))
    expect(refund.status).toBe(403)
    expect((await bookingById.PATCH(patch(`/api/bookings/${created.id}`, { status: 'CANCELLED' }), params(created.id))).status).toBe(200)

    // A revoked member loses access immediately (permissions are read from the DB, not the JWT)
    await prisma.venueMember.updateMany({ where: { userId: editor.id }, data: { status: 'invited' } })
    expect((await bookings.GET(get(`/api/bookings?venueId=${A.venue.id}`))).status).toBe(403)
    await prisma.venueMember.updateMany({ where: { userId: editor.id }, data: { status: 'active' } })
  })

  it('calendar range reflects creates, cancels and reschedules immediately', async () => {
    const q = `/api/bookings?venueId=${A.venue.id}&from=${DATE}&to=${DATE}&pageSize=2000`
    as(A.owner.id)
    expect((await (await bookings.GET(get(q))).json()).items).toHaveLength(0)

    const { id } = await (await createVia(A.owner.id, A.venue.id, A.court1.id, { start: '18:00', end: '19:30' })).json()
    as(A.owner.id)
    let items = (await (await bookings.GET(get(q))).json()).items
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ date: DATE, startMin: 1080, endMin: 1170, courtName: 'Court 1', amount: 45, status: 'CONFIRMED' })

    await bookingById.PATCH(patch(`/api/bookings/${id}`, { courtId: A.court2.id, date: DATE, start: '07:00', end: '08:00' }), params(id))
    items = (await (await bookings.GET(get(q))).json()).items
    expect(items[0]).toMatchObject({ courtName: 'Court 2', startMin: 420, amount: 20 })

    await bookingById.PATCH(patch(`/api/bookings/${id}`, { status: 'CANCELLED' }), params(id))
    items = (await (await bookings.GET(get(`${q}&status=CONFIRMED,PENDING`))).json()).items
    expect(items).toHaveLength(0)

    // Maintenance block shows up for the calendar and blocks the slot
    const blk = await courtBlocks.POST(post('/api/court-blocks', { venueId: A.venue.id, courtId: A.court1.id, date: DATE, start: '12:00', end: '14:00', reason: 'Nets' }))
    expect(blk.status).toBe(201)
    const blocks = await (await courtBlocks.GET(get(`/api/court-blocks?venueId=${A.venue.id}&from=${DATE}&to=${DATE}`))).json()
    expect(blocks).toEqual([expect.objectContaining({ courtId: A.court1.id, startMin: 720, endMin: 840, reason: 'Nets' })])
    expect((await createVia(A.owner.id, A.venue.id, A.court1.id, { start: '13:00', end: '14:00' })).status).toBe(409)
  })

  it('saving the court list keeps booked courts instead of failing or orphaning bookings', async () => {
    const { POST: saveCourts } = await import('@/app/api/venues/[id]/courts/route')
    const venue = await seedVenue(`courts${Date.now()}`)
    const { id } = await (await createVia(venue.owner.id, venue.venue.id, venue.court1.id)).json()
    as(venue.owner.id)
    // Remove Court 1 (has a booking), rename Court 2, add Court 3
    const res = await saveCourts(
      post(`/api/venues/${venue.venue.id}/courts`, { courts: [
        { id: venue.court2.id, name: 'Centre Court', type: 'Indoor', capacity: 4, description: '', sportId: venue.sport.id },
        { name: 'Court 3', type: 'Outdoor', capacity: 4, description: '', sportId: venue.sport.id },
      ] }),
      params(venue.venue.id),
    )
    expect(res.status).toBe(200)
    const courts = await prisma.court.findMany({ where: { venueId: venue.venue.id }, orderBy: { name: 'asc' } })
    expect(courts.map((c) => [c.name, c.isActive])).toEqual([['Centre Court', true], ['Court 1', false], ['Court 3', true]])
    expect(courts.find((c) => c.name === 'Centre Court')!.id).toBe(venue.court2.id) // same id, not recreated
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).courtId).toBe(venue.court1.id)
  })

  it('dashboard revenue uses payment records and updates after changes', async () => {
    const range = `/api/dashboard?venueId=${A.venue.id}&range=custom&from=${DATE}&to=${DATE}`
    const a = await (await createVia(A.owner.id, A.venue.id, A.court1.id, { start: '16:00', end: '18:00', source: 'PLAYO' })).json() // 50
    const b = await (await createVia(A.owner.id, A.venue.id, A.court2.id, { start: '09:00', end: '10:00', source: 'WALK_IN', initialPayment: { amount: 20, method: 'CASH' } })).json() // 20 paid
    const c = await (await createVia(A.owner.id, A.venue.id, A.court2.id, { start: '19:00', end: '20:00' })).json() // 30
    as(A.owner.id)

    // Payments are dated "now", so check the play-date metrics for DATE and payments separately.
    let d = await (await dashboard.GET(get(range))).json()
    expect(d.current.gross).toBe(100)
    expect(d.current.bookings).toBe(3)
    expect(d.current.pending).toEqual({ count: 2, outstanding: 80 })
    expect(d.current.channel.online).toEqual({ bookings: 1, gross: 50 })
    expect(d.current.channel.offline).toEqual({ bookings: 2, gross: 50 })
    expect(d.current.bySport).toEqual([expect.objectContaining({ name: 'Pickleball', gross: 100, bookings: 3 })])
    expect(d.current.byCourt.map((x: { name: string; gross: number }) => [x.name, x.gross]).sort()).toEqual([['Court 1', 50], ['Court 2', 50]])

    await payments.POST(post(`/api/bookings/${a.id}/payments`, { method: 'UPI', amount: 50 }), params(a.id))
    await bookingById.PATCH(patch(`/api/bookings/${c.id}`, { status: 'CANCELLED' }), params(c.id))
    await payments.POST(post(`/api/bookings/${b.id}/payments`, { kind: 'REFUND', method: 'CASH', amount: 5 }), params(b.id))

    d = await (await dashboard.GET(get(range))).json()
    expect(d.current.gross).toBe(70)
    expect(d.current.bookings).toBe(2)
    expect(d.current.cancellations).toMatchObject({ count: 1, value: 30 })
    expect(d.current.pending).toEqual({ count: 1, outstanding: 5 }) // b: 20 − (20 − 5)

    // Collected = payments − refunds received today (venue time)
    const today = await (await dashboard.GET(get(`/api/dashboard?venueId=${A.venue.id}&range=today`))).json()
    expect(today.current.paymentsReceived).toBe(70)
    expect(today.current.refunds).toBe(5)
    expect(today.current.collected).toBe(65)
    // Dashboard lists never carry contact details
    expect(today.recent.every((r: { phone: unknown; email: unknown }) => r.phone === null && r.email === null)).toBe(true)
  })
})
