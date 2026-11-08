'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CalendarDays, Clock, GraduationCap, Pencil, Plus, UserMinus, Users, Wallet } from 'lucide-react'
import {
  api, ApiError, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, fmtTime, hhmm, inputCls, METHODS, Modal, money, parseHHmm, Spinner, useBookingContext,
  type BookingContext, type PaymentMethod,
} from '@/components/bookings/shared'
import { PlayerPicker, playerPayload, type PlayerChoice } from '@/components/club/player-picker'
import { formatDays, WEEKDAYS } from '@/lib/club/schedule'

type ClassRow = {
  id: string; name: string; coachName: string | null; sportId: string | null; sportName: string | null; sportEmoji: string | null
  courtIds: string[]; courtNames: string[]; days: string[]; startMin: number; endMin: number; startDate: string; endDate: string
  capacity: number | null; enrolled: number; fee: number; feePeriod: 'MONTH' | 'TERM'; status: 'ACTIVE' | 'CANCELLED'; nextSession: string | null
}
type ClassDetail = Omit<ClassRow, 'courtNames' | 'enrolled' | 'nextSession' | 'sportEmoji'> & {
  currency: string; upcomingSessions: number
  students: { id: string; playerId: string; name: string; phone: string | null; status: 'ACTIVE' | 'WITHDRAWN'; enrolledAt: string; paid: number }[]
}
type Conflict = { date: string; courtName: string; what: string; time: string }

const CLASS_COLOR = '#7c3aed'
const feeLabel = (fee: number, period: string, cur: string) => `${money(fee, cur)} / ${period === 'MONTH' ? 'month' : 'term'}`

export function ClassesScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [rows, setRows] = useState<ClassRow[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [form, setForm] = useState<ClassDetail | 'new' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  // Deep link from the calendar: /classes?open=<classId>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('open')
    if (id && /^[a-zA-Z0-9_-]{1,64}$/.test(id)) setOpenId(id)
  }, [])

  useEffect(() => {
    if (!ctx) return
    api<{ items: ClassRow[] }>(`/api/classes?venueId=${ctx.venue.id}${showAll ? '&status=all' : ''}`).then((d) => setRows(d.items)).catch((e: ApiError) => setError(e.message))
  }, [ctx, showAll, refreshKey])

  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>
  const cur = ctx.venue.currency
  const canManage = ctx.permissions.canManageVenue

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Classes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Coaching and group sessions. Their courts are reserved on every class day.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show past & cancelled</label>
          {canManage && (
            <button onClick={() => setForm('new')} className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90" style={{ background: BRAND_GRADIENT }}>
              <Plus size={14} /> New Class
            </button>
          )}
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={() => { setError(null); refresh() }} /> : !rows ? (
        <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-border text-center py-16">
          <GraduationCap size={30} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No classes yet.</p>
          {canManage && <button onClick={() => setForm('new')} className="mt-3 text-sm text-primary hover:underline">Create the first class</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((c) => {
            const full = c.capacity != null && c.enrolled >= c.capacity
            return (
              <button key={c.id} onClick={() => setOpenId(c.id)}
                className={`text-left bg-white rounded-xl border border-border p-5 hover:border-primary/40 hover:shadow-sm transition-all ${c.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground truncate">{c.sportEmoji ? `${c.sportEmoji} ` : ''}{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{c.coachName ? `Coach: ${c.coachName}` : "No coach set"}{c.sportName ? ` · ${c.sportName}` : ''}</p>
                  </div>
                  {c.status === 'CANCELLED' ? <span className="text-xs font-medium text-red-600">Cancelled</span>
                    : full ? <span className="text-xs font-medium text-amber-700">Full</span> : null}
                </div>
                <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                  <p className="flex items-center gap-2"><Clock size={13} /> {formatDays(c.days)} · {fmtTime(c.startMin)} – {fmtTime(c.endMin)}</p>
                  <p className="flex items-center gap-2"><CalendarDays size={13} /> {fmtDate(c.startDate, { month: 'short', day: 'numeric' })} – {fmtDate(c.endDate, { month: 'short', day: 'numeric', year: 'numeric' })} · {c.courtNames.join(', ')}</p>
                  <p className="flex items-center gap-2"><Users size={13} /> {c.enrolled}{c.capacity != null ? ` / ${c.capacity}` : ''} students · {feeLabel(c.fee, c.feePeriod, cur)}</p>
                </div>
                {c.capacity != null && (
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden mt-3">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, (c.enrolled / c.capacity) * 100)}%`, background: CLASS_COLOR }} />
                  </div>
                )}
                {c.nextSession && c.status === 'ACTIVE' && (
                  <p className="text-xs text-muted-foreground mt-2">Next: {new Date(c.nextSession).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: ctx.venue.timezone })}</p>
                )}
              </button>
            )
          })}
        </div>
      )}

      {form && <ClassForm ctx={ctx} cls={form === 'new' ? null : form} onClose={() => setForm(null)} onDone={(id) => { setForm(null); refresh(); setOpenId(id) }} />}
      {openId && !form && (
        <ClassPanel ctx={ctx} classId={openId} onClose={() => setOpenId(null)} onChanged={refresh} onEdit={(c) => setForm(c)} />
      )}
    </div>
  )
}

function ClassForm({ ctx, cls, onClose, onDone }: { ctx: BookingContext; cls: ClassDetail | null; onClose: () => void; onDone: (id: string) => void }) {
  const activeCourts = ctx.courts.filter((c) => c.isActive)
  const [name, setName] = useState(cls?.name ?? '')
  const [coachName, setCoachName] = useState(cls?.coachName ?? '')
  const [sportId, setSportId] = useState(cls?.sportId ?? '')
  const [courtIds, setCourtIds] = useState<string[]>(cls?.courtIds ?? [])
  const [days, setDays] = useState<string[]>(cls?.days ?? [])
  const [start, setStart] = useState(hhmm(cls?.startMin ?? 17 * 60))
  const [end, setEnd] = useState(hhmm(cls?.endMin ?? 18 * 60))
  const [startDate, setStartDate] = useState(cls?.startDate ?? ctx.today)
  const [endDate, setEndDate] = useState(cls?.endDate ?? '')
  const [capacity, setCapacity] = useState(cls?.capacity != null ? String(cls.capacity) : '')
  const [fee, setFee] = useState(cls ? String(cls.fee) : '')
  const [feePeriod, setFeePeriod] = useState<'MONTH' | 'TERM'>(cls?.feePeriod ?? 'MONTH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
  const courtsForSport = activeCourts.filter((c) => !sportId || !c.sportId || c.sportId === sportId)

  async function save(skipConflicts = false) {
    if (!name.trim()) return setError('Class name is required')
    if (!courtIds.length) return setError('Choose at least one court')
    if (!days.length) return setError('Choose at least one day')
    if (!endDate) return setError('Choose an end date for the term')
    if (fee === '' || !(Number(fee) >= 0)) return setError('Enter a fee (0 if free)')
    const s = parseHHmm(start), e = parseHHmm(end)
    if (s == null || e == null || e <= s) return setError('End time must be after start time')
    setBusy(true); setError(null)
    const body = {
      venueId: ctx.venue.id, name, coachName: coachName || null, sportId: sportId || null, courtIds, days, start, end,
      startDate, endDate, capacity: capacity === '' ? null : Number(capacity), fee: Number(fee), feePeriod, skipConflicts,
    }
    try {
      const r = cls
        ? await api<{ id: string; sessions: number | null; skipped: number }>(`/api/classes/${cls.id}`, { method: 'PATCH', json: body })
        : await api<{ id: string; sessions: number; skipped: number }>('/api/classes', { method: 'POST', json: body })
      toast.success(cls ? 'Class updated' : `Class created${r.sessions != null ? ` · ${r.sessions} court session${r.sessions === 1 ? '' : 's'} reserved` : ''}${r.skipped ? ` (${r.skipped} skipped)` : ''}`)
      onDone(r.id)
    } catch (err) {
      const ae = err as ApiError
      const list = (ae.details?.conflicts as Conflict[] | undefined) ?? null
      setConflicts(ae.status === 409 && list ? list : null)
      setError(ae.message)
    } finally { setBusy(false) }
  }

  const label = (t: string) => <label className="block text-xs font-medium text-muted-foreground mb-1">{t}</label>

  return (
    <Modal title={cls ? 'Edit class' : 'New class'} subtitle={`Times in ${ctx.venue.timezone.replace(/_/g, ' ')}`} onClose={onClose} width="max-w-xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={() => save(false)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} {cls ? 'Save class' : 'Create class'}</button>
      </div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">{label('Class name *')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Junior Coaching" className={inputCls} autoFocus /></div>
          <div>{label('Coach')}<input value={coachName} onChange={(e) => setCoachName(e.target.value)} maxLength={80} placeholder="Coach name" className={inputCls} /></div>
          <div>{label('Sport')}
            <select value={sportId} onChange={(e) => setSportId(e.target.value)} className={inputCls}>
              <option value="">Any</option>{ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></div>
        </div>

        <div>{label('Courts *')}
          <div className="flex flex-wrap gap-2">
            {courtsForSport.map((c) => (
              <button key={c.id} type="button" onClick={() => setCourtIds(toggle(courtIds, c.id))}
                className={`px-3 py-1.5 rounded-lg border text-sm transition-all ${courtIds.includes(c.id) ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>{c.name}</button>
            ))}
          </div></div>

        <div>{label('Days *')}
          <div className="flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <button key={d} type="button" onClick={() => setDays(toggle(days, d))}
                className={`w-12 py-1.5 rounded-lg border text-sm transition-all ${days.includes(d) ? 'border-purple-400 bg-purple-50 text-purple-700 font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>{d.charAt(0) + d.slice(1, 3).toLowerCase()}</button>
            ))}
          </div></div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>{label('Starts at')}<input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} /></div>
          <div>{label('Ends at')}<input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} /></div>
          <div>{label('Term start')}<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} /></div>
          <div>{label('Term end *')}<input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} /></div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>{label('Capacity')}<input type="number" min={1} max={500} value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="No limit" className={inputCls} /></div>
          <div>{label('Fee *')}<input type="number" min={0} step="0.01" value={fee} onChange={(e) => setFee(e.target.value)} className={inputCls} /></div>
          <div>{label('Per')}<select value={feePeriod} onChange={(e) => setFeePeriod(e.target.value as 'MONTH' | 'TERM')} className={inputCls}><option value="MONTH">Month</option><option value="TERM">Term</option></select></div>
        </div>

        {cls && <p className="text-xs text-muted-foreground">Changing days, times, courts or dates re-reserves court time from today; past sessions are kept.</p>}

        {conflicts && conflicts.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-sm font-medium text-amber-800 flex items-center gap-2"><AlertTriangle size={14} /> These sessions clash with existing bookings or blocks</p>
            <ul className="mt-2 max-h-36 overflow-y-auto text-xs text-amber-900 space-y-1">
              {conflicts.map((c, i) => <li key={i}>{fmtDate(c.date)} · {c.courtName} · {c.what} ({c.time})</li>)}
            </ul>
            <p className="text-xs text-amber-800 mt-2">Move or cancel those bookings first, or skip just these sessions.</p>
            <button onClick={() => save(true)} disabled={busy} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60">
              {cls ? 'Save' : 'Create'} anyway, skipping {conflicts.length} session{conflicts.length === 1 ? '' : 's'}
            </button>
          </div>
        )}
        {error && !conflicts?.length && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

function ClassPanel({ ctx, classId, onClose, onChanged, onEdit }: { ctx: BookingContext; classId: string; onClose: () => void; onChanged: () => void; onEdit: (c: ClassDetail) => void }) {
  const [c, setC] = useState<ClassDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [paying, setPaying] = useState<ClassDetail['students'][number] | null>(null)
  const [withdrawing, setWithdrawing] = useState<ClassDetail['students'][number] | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const load = useCallback(() => { api<ClassDetail>(`/api/classes/${classId}`).then(setC).catch((e: ApiError) => setError(e.message)) }, [classId])
  useEffect(load, [load])
  const changed = () => { load(); onChanged() }

  const cur = c?.currency ?? ctx.venue.currency
  const active = c?.students.filter((s) => s.status === 'ACTIVE') ?? []
  const full = c?.capacity != null && active.length >= c.capacity
  const courtName = (id: string) => ctx.courts.find((x) => x.id === id)?.name ?? 'Removed court'

  return (
    <>
      <Modal title={c?.name ?? 'Class'} subtitle={c ? `${c.coachName ? `Coach: ${c.coachName} · ` : ''}${feeLabel(c.fee, c.feePeriod, cur)}` : undefined} onClose={onClose} width="max-w-2xl"
        footer={c && c.status === 'ACTIVE' ? (
          <div className="flex flex-wrap gap-2 justify-between">
            <div className="flex gap-2">
              {ctx.permissions.canEditBookings && (
                <button onClick={() => setEnrolling(true)} disabled={full} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: BRAND_GRADIENT }}>
                  <Plus size={13} /> {full ? 'Class full' : 'Enrol student'}
                </button>
              )}
            </div>
            {ctx.permissions.canManageVenue && (
              <div className="flex gap-2">
                <button onClick={() => onEdit(c)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted"><Pencil size={13} /> Edit</button>
                <button onClick={() => setCancelling(true)} className="px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">Cancel class</button>
              </div>
            )}
          </div>
        ) : undefined}>
        {error ? <ErrorState message={error} onRetry={load} /> : !c ? <div className="flex justify-center py-10 text-muted-foreground"><Spinner /></div> : (
          <div className="space-y-4">
            {c.status === 'CANCELLED' && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">This class is cancelled. Its future court time has been released.</div>}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm">
              {[
                ['Schedule', `${formatDays(c.days)} · ${fmtTime(c.startMin)} – ${fmtTime(c.endMin)}`],
                ['Courts', c.courtIds.map(courtName).join(', ')],
                ['Term', `${fmtDate(c.startDate, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDate(c.endDate, { month: 'short', day: 'numeric', year: 'numeric' })}`],
                ['Sessions ahead', `${c.upcomingSessions} court session${c.upcomingSessions === 1 ? '' : 's'} reserved`],
                ['Students', `${active.length}${c.capacity != null ? ` of ${c.capacity}` : ''}`],
                ['Sport', c.sportName ?? 'Any'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2 border-b border-border">
                  <dt className="text-muted-foreground">{k}</dt><dd className="font-medium text-right">{v}</dd>
                </div>
              ))}
            </dl>

            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Students</p>
              {c.students.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No students enrolled yet.</p> : (
                <div className="border border-border rounded-lg divide-y divide-border">
                  {c.students.map((s) => (
                    <div key={s.id} className={`flex items-center justify-between gap-3 px-3 py-2 ${s.status === 'WITHDRAWN' ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{s.name}{s.status === 'WITHDRAWN' && <span className="text-xs text-muted-foreground"> · withdrawn</span>}</p>
                        <p className="text-xs text-muted-foreground">{[s.phone, `Paid ${money(s.paid, cur)}`].filter(Boolean).join(' · ')}</p>
                      </div>
                      {ctx.permissions.canEditBookings && s.status === 'ACTIVE' && (
                        <div className="flex gap-1 flex-shrink-0">
                          <button onClick={() => setPaying(s)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50"><Wallet size={12} /> Payment</button>
                          <button onClick={() => setWithdrawing(s)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50"><UserMinus size={12} /> Withdraw</button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {enrolling && c && <EnrollDialog ctx={ctx} cls={c} onClose={() => setEnrolling(false)} onDone={() => { setEnrolling(false); changed() }} />}
      {paying && c && <ClassPayment student={paying} cls={c} onClose={() => setPaying(null)} onDone={() => { setPaying(null); changed() }} />}
      {withdrawing && (
        <ConfirmDialog title={`Withdraw ${withdrawing.name}?`} message="They leave the class and free a seat. Their payments stay on record." confirmLabel="Withdraw" danger
          onCancel={() => setWithdrawing(null)}
          onConfirm={async () => {
            try { await api(`/api/enrollments/${withdrawing.id}`, { method: 'DELETE' }); toast.success('Student withdrawn'); changed() }
            catch (e) { toast.error((e as ApiError).message) }
            setWithdrawing(null)
          }} />
      )}
      {cancelling && c && (
        <ConfirmDialog title={`Cancel ${c.name}?`} message={`All ${c.upcomingSessions} upcoming court sessions are released so the courts can be booked again. Students and payments stay on record.`} confirmLabel="Cancel class" danger
          onCancel={() => setCancelling(false)}
          onConfirm={async () => {
            try { await api(`/api/classes/${c.id}`, { method: 'DELETE' }); toast.success('Class cancelled'); changed() }
            catch (e) { toast.error((e as ApiError).message) }
            setCancelling(false)
          }} />
      )}
    </>
  )
}

function EnrollDialog({ ctx, cls, onClose, onDone }: { ctx: BookingContext; cls: ClassDetail; onClose: () => void; onDone: () => void }) {
  const [player, setPlayer] = useState<PlayerChoice>(null)
  const [takePayment, setTakePayment] = useState(cls.fee > 0)
  const [amount, setAmount] = useState(String(cls.fee))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    if (!player || (player.kind === 'new' && !player.name.trim())) return setError('Choose a student or enter a name')
    if (takePayment && !(Number(amount) > 0)) return setError('Enter the amount received')
    setBusy(true); setError(null)
    try {
      await api(`/api/classes/${cls.id}/enrollments`, { method: 'POST', json: { ...playerPayload(player), payment: takePayment ? { amount: Number(amount), method } : null } })
      toast.success('Student enrolled')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Enrol student" subtitle={cls.name} onClose={onClose} width="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Enrol</button>
      </div>}>
      <div className="space-y-4">
        <PlayerPicker ctx={ctx} value={player} onChange={setPlayer} label="Student" />
        <div className="rounded-lg border border-border p-3 space-y-2">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} /> Record fee payment now ({feeLabel(cls.fee, cls.feePeriod, cls.currency)})</label>
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

function ClassPayment({ student, cls, onClose, onDone }: { student: ClassDetail['students'][number]; cls: ClassDetail; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(cls.fee))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [note, setNote] = useState(cls.feePeriod === 'MONTH' ? new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function pay() {
    if (!(Number(amount) > 0)) return setError('Enter an amount')
    setBusy(true); setError(null)
    try {
      await api(`/api/enrollments/${student.id}/payments`, { method: 'POST', json: { amount: Number(amount), method, note: note || null } })
      toast.success('Payment recorded')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Record class fee" subtitle={`${student.name} · ${cls.name}`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={pay} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Record payment</button>
      </div>}>
      <p className="text-sm text-muted-foreground mb-3">Paid so far: <b className="text-foreground">{money(student.paid, cls.currency)}</b></p>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="For (e.g. November)" className={`${inputCls} mt-2`} />
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Modal>
  )
}
