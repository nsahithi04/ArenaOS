'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Clock, Copy, Pencil, Plus, Send, Trash2, Wallet } from 'lucide-react'
import {
  addDays, api, ApiError, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, fmtDuration, fmtTime, hhmm, inputCls, METHODS, Modal, money, parseHHmm, Spinner, useBookingContext, weekStart,
  type BookingContext, type PaymentMethod,
} from '@/components/bookings/shared'

type Member = { id: string; name: string; role: string | null; roleColor: string | null; position: string | null; status: string; isYou: boolean; canEdit: boolean; hasAccount: boolean; onClockSince: string | null }
type Shift = { id: string; memberId: string; date: string; startMin: number; endMin: number; position: string | null; notes: string | null; published: boolean }
type StaffData = { from: string; to: string; today: string; timezone: string; members: Member[]; shifts: Shift[]; drafts: number }
type Tab = 'schedule' | 'time' | 'payroll'

export function StaffScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [tab, setTab] = useState<Tab>('schedule')
  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Staff</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Schedule shifts, track hours and pay your team.</p>
      </div>
      <div className="flex gap-1 bg-white rounded-xl border border-border p-1 w-fit">
        {([['schedule', 'Schedule'], ['time', 'Time sheets'], ['payroll', 'Payroll']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>{l}</button>
        ))}
      </div>
      {tab === 'schedule' && <Schedule ctx={ctx} />}
      {tab === 'time' && <TimeSheets ctx={ctx} />}
      {tab === 'payroll' && <Payroll ctx={ctx} />}
    </div>
  )
}

function useStaff(ctx: BookingContext, week: string) {
  const [data, setData] = useState<StaffData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    api<StaffData>(`/api/staff?venueId=${ctx.venue.id}&from=${week}&to=${addDays(week, 6)}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [ctx.venue.id, week])
  useEffect(load, [load])
  return { data, error, load }
}

function WeekNav({ week, setWeek, today }: { week: string; setWeek: (w: string) => void; today: string }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week" className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center"><ChevronLeft size={14} /></button>
      <button onClick={() => setWeek(weekStart(today))} className="px-2.5 h-8 rounded-lg border border-border hover:bg-muted text-xs font-medium">This week</button>
      <span className="text-sm font-medium min-w-40 text-center">{fmtDate(week, { month: 'short', day: 'numeric' })} – {fmtDate(addDays(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      <button onClick={() => setWeek(addDays(week, 7))} aria-label="Next week" className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center"><ChevronRight size={14} /></button>
    </div>
  )
}

// ─── Schedule ───────────────────────────────────────────────────────────────

function Schedule({ ctx }: { ctx: BookingContext }) {
  const [week, setWeek] = useState(weekStart(ctx.today))
  const { data, error, load } = useStaff(ctx, week)
  const [dialog, setDialog] = useState<{ shift?: Shift; memberId?: string; date?: string } | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [busy, setBusy] = useState(false)
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const editable = data?.members.filter((m) => m.canEdit) ?? []

  async function publish() {
    setBusy(true)
    try {
      const r = await api<{ published: number; notified: string[]; emailFailed: string[] }>('/api/staff/shifts/publish', { method: 'POST', json: { venueId: ctx.venue.id, from: week, to: addDays(week, 6) } })
      toast.success(r.published ? `Published ${r.published} shift${r.published === 1 ? '' : 's'} · ${r.notified.length} notified` : 'Nothing new to publish')
      if (r.emailFailed.length) toast.error(`Email failed for ${r.emailFailed.join(', ')} (they still got an in-app notification)`)
      load()
    } catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false); setConfirmPublish(false) }
  }
  async function copyLast() {
    setBusy(true)
    try {
      const r = await api<{ created: number; skipped: number }>('/api/staff/shifts/copy-week', { method: 'POST', json: { venueId: ctx.venue.id, fromWeek: addDays(week, -7), toWeek: week } })
      toast.success(r.created ? `Copied ${r.created} shift${r.created === 1 ? '' : 's'} as drafts${r.skipped ? ` (${r.skipped} skipped: already scheduled)` : ''}` : 'Nothing to copy from last week')
      load()
    } catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false) }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <WeekNav week={week} setWeek={setWeek} today={ctx.today} />
        {editable.length > 0 && (
          <div className="flex gap-2">
            <button onClick={copyLast} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"><Copy size={13} /> Copy last week</button>
            <button onClick={() => setConfirmPublish(true)} disabled={busy || !data?.drafts} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: BRAND_GRADIENT }}>
              <Send size={13} /> Publish & notify{data?.drafts ? ` (${data.drafts})` : ''}
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-border overflow-x-auto">
        {!data ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : data.members.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-14">No team members yet. Invite them under Settings → Team Members.</p>
        ) : (
          <table className="w-full min-w-[980px] table-fixed">
            <thead>
              <tr className="bg-muted/40">
                <th className="w-48 text-left text-xs font-medium text-muted-foreground px-3 py-2.5">Team member</th>
                {days.map((d) => (
                  <th key={d} className={`text-left text-xs font-medium px-2 py-2.5 ${d === ctx.today ? 'text-primary' : 'text-muted-foreground'}`}>{fmtDate(d, { weekday: 'short', day: 'numeric' })}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.members.map((m) => (
                <tr key={m.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <p className="text-sm font-medium truncate flex items-center gap-1.5">
                      {m.onClockSince && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="On the clock now" />}
                      {m.name}{m.isYou && <span className="text-xs text-muted-foreground font-normal">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{[m.position, m.role].filter(Boolean).join(' · ') || '—'}{m.status !== 'active' ? ' · invited' : ''}</p>
                  </td>
                  {days.map((d) => {
                    const list = data.shifts.filter((s) => s.memberId === m.id && s.date === d)
                    return (
                      <td key={d} className={`px-1.5 py-1.5 group ${d === ctx.today ? 'bg-green-50/30' : ''}`}>
                        <div className="space-y-1 min-h-10">
                          {list.map((s) => (
                            <button key={s.id} disabled={!m.canEdit} onClick={() => setDialog({ shift: s })}
                              className={`w-full text-left rounded-md px-1.5 py-1 text-[11px] leading-tight border ${s.published ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-white border-dashed border-amber-400 text-amber-800'} ${m.canEdit ? 'hover:shadow-sm' : 'cursor-default'}`}>
                              <span className="font-semibold block">{fmtTime(s.startMin)}–{fmtTime(s.endMin)}</span>
                              <span className="block truncate">{s.position ?? ''}{!s.published && ' · draft'}</span>
                            </button>
                          ))}
                          {m.canEdit && (
                            <button onClick={() => setDialog({ memberId: m.id, date: d })} aria-label={`Add shift for ${m.name} on ${d}`}
                              className="w-full h-6 rounded-md border border-dashed border-transparent text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:border-border hover:bg-muted flex items-center justify-center"><Plus size={12} /></button>
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Dashed shifts are drafts: the person can&apos;t see them until you publish. Publishing emails each person their week and adds an in-app notification. A green dot means they&apos;re clocked in now.</p>

      {dialog && data && (
        <ShiftDialog ctx={ctx} members={editable} shift={dialog.shift} memberId={dialog.memberId} date={dialog.date}
          onClose={() => setDialog(null)} onDone={() => { setDialog(null); load() }} />
      )}
      {confirmPublish && data && (
        <ConfirmDialog title={`Publish ${data.drafts} shift${data.drafts === 1 ? '' : 's'}?`} confirmLabel="Publish & notify" busy={busy}
          message="Each person with new or changed shifts this week gets an email and an in-app notification with their schedule."
          onCancel={() => setConfirmPublish(false)} onConfirm={publish} />
      )}
    </div>
  )
}

function ShiftDialog({ ctx, members, shift, memberId, date, onClose, onDone }: {
  ctx: BookingContext; members: Member[]; shift?: Shift; memberId?: string; date?: string; onClose: () => void; onDone: () => void
}) {
  const [who, setWho] = useState(shift?.memberId ?? memberId ?? members[0]?.id ?? '')
  const [day, setDay] = useState(shift?.date ?? date ?? ctx.today)
  const [start, setStart] = useState(hhmm(shift?.startMin ?? 9 * 60))
  const [end, setEnd] = useState(hhmm(shift ? shift.endMin % 1440 : 17 * 60))
  const defaultPosition = members.find((m) => m.id === who)?.position ?? ''
  const [position, setPosition] = useState(shift?.position ?? defaultPosition)
  const [notes, setNotes] = useState(shift?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const s = parseHHmm(start), e = parseHHmm(end)
  const length = s != null && e != null ? (e === 0 ? 1440 : e) - s : 0

  async function save() {
    if (length <= 0) return setError('End must be after start (shifts can’t cross midnight)')
    setBusy(true); setError(null)
    const body = { venueId: ctx.venue.id, memberId: who, date: day, start, end, position: position || null, notes: notes || null }
    try {
      if (shift) await api(`/api/staff/shifts/${shift.id}`, { method: 'PATCH', json: body })
      else await api('/api/staff/shifts', { method: 'POST', json: body })
      toast.success(shift ? 'Shift updated (draft until published)' : 'Shift added as a draft')
      onDone()
    } catch (err) { setError((err as ApiError).message) } finally { setBusy(false) }
  }
  async function remove() {
    try { await api(`/api/staff/shifts/${shift!.id}`, { method: 'DELETE' }); toast.success(shift!.published ? 'Shift deleted · they’ve been notified' : 'Draft deleted'); onDone() }
    catch (err) { toast.error((err as ApiError).message) }
  }

  return (
    <>
      <Modal title={shift ? 'Edit shift' : 'Add shift'} subtitle={shift ? (shift.published ? 'Published: changes go back to draft until you publish again' : 'Draft') : 'Saved as a draft until you publish'} onClose={onClose} width="max-w-md"
        footer={<div className="flex items-center justify-between">
          <div>{shift && <button onClick={() => setConfirmDelete(true)} className="flex items-center gap-1 text-xs text-red-600 hover:underline"><Trash2 size={12} /> Delete</button>}</div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
            <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Save</button>
          </div>
        </div>}>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Team member</label>
            <select value={who} onChange={(ev) => { setWho(ev.target.value); if (!position) setPosition(members.find((m) => m.id === ev.target.value)?.position ?? '') }} className={inputCls}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.position ? ` · ${m.position}` : ''}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Date</label><input type="date" value={day} onChange={(ev) => setDay(ev.target.value)} className={inputCls} /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">Start</label><input type="time" step={900} value={start} onChange={(ev) => setStart(ev.target.value)} className={inputCls} /></div>
            <div><label className="block text-xs font-medium text-muted-foreground mb-1">End</label><input type="time" step={900} value={end} onChange={(ev) => setEnd(ev.target.value)} className={inputCls} /></div>
          </div>
          {length > 0 && <p className="text-xs text-muted-foreground -mt-1">{fmtDuration(length)}</p>}
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Position</label><input value={position} onChange={(ev) => setPosition(ev.target.value)} maxLength={60} placeholder="Front desk, Coach, Cleaning…" className={inputCls} /></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Notes</label><input value={notes} onChange={(ev) => setNotes(ev.target.value)} maxLength={300} placeholder="Optional" className={inputCls} /></div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </Modal>
      {confirmDelete && (
        <ConfirmDialog title="Delete this shift?" danger confirmLabel="Delete" onCancel={() => setConfirmDelete(false)} onConfirm={remove}
          message={shift?.published ? 'It has been published, so the person will be told it’s cancelled.' : 'It’s a draft, so nobody has seen it yet.'} />
      )}
    </>
  )
}

// ─── Time sheets ────────────────────────────────────────────────────────────

type Entry = { id: string; memberId: string; name: string; date: string; inMin: number; outMin: number | null; outDate: string | null; minutes: number; open: boolean; manual: boolean; note: string | null; shift: { startMin: number; endMin: number } | null; canEdit: boolean }

function TimeSheets({ ctx }: { ctx: BookingContext }) {
  const [week, setWeek] = useState(weekStart(ctx.today))
  const { data: staff } = useStaff(ctx, week)
  const [items, setItems] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Entry | 'new' | null>(null)
  const [deleting, setDeleting] = useState<Entry | null>(null)
  const load = useCallback(() => {
    setItems(null)
    api<{ items: Entry[] }>(`/api/staff/time-entries?venueId=${ctx.venue.id}&from=${week}&to=${addDays(week, 6)}`).then((d) => setItems(d.items)).catch((e: ApiError) => setError(e.message))
  }, [ctx.venue.id, week])
  useEffect(load, [load])
  const totals = useMemo(() => {
    const m = new Map<string, { name: string; minutes: number }>()
    for (const e of items ?? []) { const t = m.get(e.memberId) ?? { name: e.name, minutes: 0 }; t.minutes += e.minutes; m.set(e.memberId, t) }
    return [...m.values()].sort((a, b) => b.minutes - a.minutes)
  }, [items])
  const editable = staff?.members.filter((m) => m.canEdit) ?? []

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-2 flex flex-col lg:flex-row lg:items-center justify-between gap-2">
        <WeekNav week={week} setWeek={setWeek} today={ctx.today} />
        {editable.length > 0 && <button onClick={() => setDialog('new')} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white" style={{ background: BRAND_GRADIENT }}><Plus size={13} /> Add time entry</button>}
      </div>
      {totals.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {totals.map((t) => <span key={t.name} className="px-3 py-1.5 rounded-lg bg-white border border-border text-xs"><b>{t.name}</b> · {fmtDuration(t.minutes)}</span>)}
        </div>
      )}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {error ? <ErrorState message={error} onRetry={load} /> : !items ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-14">No time recorded this week.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] whitespace-nowrap">
              <thead><tr className="bg-muted/40">{['Person', 'Date', 'In', 'Out', 'Hours', 'Scheduled', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-4 py-2.5 text-sm font-medium">{e.name}{e.manual && <span className="ml-1.5 text-[10px] text-muted-foreground uppercase">edited</span>}</td>
                    <td className="px-4 py-2.5 text-sm">{fmtDate(e.date)}</td>
                    <td className="px-4 py-2.5 text-sm">{fmtTime(e.inMin)}</td>
                    <td className="px-4 py-2.5 text-sm">{e.open ? <span className="text-green-700 font-medium flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500" /> On the clock</span> : `${fmtTime(e.outMin!)}${e.outDate && e.outDate !== e.date ? ' (+1d)' : ''}`}</td>
                    <td className="px-4 py-2.5 text-sm font-medium">{fmtDuration(e.minutes)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{e.shift ? `${fmtTime(e.shift.startMin)}–${fmtTime(e.shift.endMin)}` : 'Unscheduled'}</td>
                    <td className="px-4 py-2.5">
                      {e.canEdit && !e.open && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setDialog(e)} aria-label="Edit" className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground"><Pencil size={13} /></button>
                          <button onClick={() => setDeleting(e)} aria-label="Delete" className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500"><Trash2 size={13} /></button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {dialog && <TimeEntryDialog ctx={ctx} members={editable} entry={dialog === 'new' ? null : dialog} onClose={() => setDialog(null)} onDone={() => { setDialog(null); load() }} />}
      {deleting && (
        <ConfirmDialog title="Delete this time entry?" danger confirmLabel="Delete" message={`${deleting.name}, ${fmtDate(deleting.date)}, ${fmtDuration(deleting.minutes)}. Their pay for the period will change.`}
          onCancel={() => setDeleting(null)}
          onConfirm={async () => { try { await api(`/api/staff/time-entries/${deleting.id}`, { method: 'DELETE' }); toast.success('Time entry deleted'); load() } catch (er) { toast.error((er as ApiError).message) } setDeleting(null) }} />
      )}
    </div>
  )
}

function TimeEntryDialog({ ctx, members, entry, onClose, onDone }: { ctx: BookingContext; members: Member[]; entry: Entry | null; onClose: () => void; onDone: () => void }) {
  const [who, setWho] = useState(entry?.memberId ?? members[0]?.id ?? '')
  const [date, setDate] = useState(entry?.date ?? ctx.today)
  const [cin, setCin] = useState(hhmm(entry?.inMin ?? 9 * 60))
  const [cout, setCout] = useState(entry?.outMin != null ? hhmm(entry.outMin) : hhmm(17 * 60))
  const [note, setNote] = useState(entry?.note ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    setBusy(true); setError(null)
    const body = { venueId: ctx.venue.id, memberId: who, date, clockIn: cin, clockOut: cout, note: note || null }
    try {
      if (entry) await api(`/api/staff/time-entries/${entry.id}`, { method: 'PATCH', json: body })
      else await api('/api/staff/time-entries', { method: 'POST', json: body })
      toast.success('Time saved'); onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={entry ? 'Correct time entry' : 'Add time entry'} subtitle="For missed or wrong clock-ins" onClose={onClose} width="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Save</button>
      </div>}>
      <div className="space-y-3">
        <select value={who} onChange={(e) => setWho(e.target.value)} className={inputCls}>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <div className="grid grid-cols-3 gap-2">
          <input type="date" value={date} max={ctx.today} onChange={(e) => setDate(e.target.value)} className={inputCls} aria-label="Date" />
          <input type="time" step={300} value={cin} onChange={(e) => setCin(e.target.value)} className={inputCls} aria-label="Clock in" />
          <input type="time" step={300} value={cout} onChange={(e) => setCout(e.target.value)} className={inputCls} aria-label="Clock out" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reason (optional)" className={inputCls} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

// ─── Payroll ────────────────────────────────────────────────────────────────

type PayRow = { memberId: string; name: string; role: string | null; position: string | null; isYou: boolean; payType: 'HOURLY' | 'MONTHLY' | null; payRate: number | null; scheduledMinutes: number; workedMinutes: number; onClock: boolean; gross: number | null; paid: number; balance: number | null; canPay: boolean }

function Payroll({ ctx }: { ctx: BookingContext }) {
  const cur = ctx.venue.currency
  const [range, setRange] = useState('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [data, setData] = useState<{ from: string; to: string; rows: PayRow[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editPay, setEditPay] = useState<PayRow | null>(null)
  const [payout, setPayout] = useState<PayRow | null>(null)
  const load = useCallback(() => {
    if (range === 'custom' && (!custom.from || !custom.to)) return
    const p = new URLSearchParams({ venueId: ctx.venue.id, range })
    if (range === 'custom') { p.set('from', custom.from); p.set('to', custom.to) }
    api<typeof data>(`/api/staff/payroll?${p}`).then(setData).catch((e: ApiError) => setError(e.message))
  }, [ctx.venue.id, range, custom])
  useEffect(load, [load])
  const total = (k: 'gross' | 'paid' | 'balance') => (data?.rows ?? []).reduce((s, r) => s + (r[k] ?? 0), 0)
  const rateLabel = (r: PayRow) => (r.payType === 'HOURLY' ? `${money(r.payRate, cur)}/hr` : r.payType === 'MONTHLY' ? `${money(r.payRate, cur)}/mo` : 'Not set')

  return (
    <div className="space-y-3">
      <div className="bg-white rounded-xl border border-border p-2 flex flex-wrap items-center gap-2">
        <select value={range} onChange={(e) => setRange(e.target.value)} className={`${inputCls} w-auto`} aria-label="Pay period">
          <option value="month">This month</option><option value="lastmonth">Last month</option><option value="week">This week</option><option value="custom">Custom</option>
        </select>
        {range === 'custom' && (<><input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={`${inputCls} w-auto`} /><input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={`${inputCls} w-auto`} /></>)}
        {data && <span className="text-sm text-muted-foreground">{fmtDate(data.from, { month: 'short', day: 'numeric' })} – {fmtDate(data.to, { month: 'short', day: 'numeric', year: 'numeric' })}</span>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[['Earned', total('gross'), ''], ['Paid out', total('paid'), 'text-green-700'], ['Still owed', total('balance'), 'text-amber-700']].map(([l, v, c]) => (
          <div key={l as string} className="bg-white rounded-xl border border-border px-4 py-3"><p className="text-xs text-muted-foreground">{l as string}</p><p className={`text-lg font-semibold ${c}`}>{data ? money(v as number, cur) : '—'}</p></div>
        ))}
      </div>
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        {error ? <ErrorState message={error} onRetry={load} /> : !data ? <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div> : data.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-14">No team members you can see pay for.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] whitespace-nowrap">
              <thead><tr className="bg-muted/40">{['Person', 'Pay', 'Scheduled', 'Worked', 'Earned', 'Paid', 'Owed', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}</tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.memberId} className="border-t border-border">
                    <td className="px-4 py-2.5"><p className="text-sm font-medium flex items-center gap-1.5">{r.onClock && <span className="w-2 h-2 rounded-full bg-green-500" title="On the clock" />}{r.name}{r.isYou && <span className="text-xs text-muted-foreground font-normal">(you)</span>}</p><p className="text-xs text-muted-foreground">{[r.position, r.role].filter(Boolean).join(' · ') || '—'}</p></td>
                    <td className={`px-4 py-2.5 text-sm ${r.payType ? '' : 'text-muted-foreground'}`}>{rateLabel(r)}</td>
                    <td className="px-4 py-2.5 text-sm text-muted-foreground">{fmtDuration(r.scheduledMinutes) || '0h'}</td>
                    <td className="px-4 py-2.5 text-sm"><span className="flex items-center gap-1"><Clock size={12} className="text-muted-foreground" />{r.workedMinutes ? fmtDuration(r.workedMinutes) : '0h'}</span></td>
                    <td className="px-4 py-2.5 text-sm font-medium">{money(r.gross, cur)}</td>
                    <td className="px-4 py-2.5 text-sm text-green-700">{money(r.paid, cur)}</td>
                    <td className={`px-4 py-2.5 text-sm font-semibold ${(r.balance ?? 0) > 0 ? 'text-amber-700' : 'text-muted-foreground'}`}>{money(r.balance, cur)}</td>
                    <td className="px-4 py-2.5">
                      {r.canPay && (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditPay(r)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-muted-foreground hover:bg-muted"><Pencil size={12} /> Pay</button>
                          <button onClick={() => setPayout(r)} disabled={!r.payType} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-40"><Wallet size={12} /> Record payout</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Hourly pay = hours worked (from clock-ins and corrections) × rate. Monthly salary is pro-rated by days in the period. Payouts are counted in the period they cover.</p>
      {editPay && <PayDialog ctx={ctx} row={editPay} onClose={() => setEditPay(null)} onDone={() => { setEditPay(null); load() }} />}
      {payout && data && <PayoutDialog ctx={ctx} row={payout} from={data.from} to={data.to} onClose={() => setPayout(null)} onDone={() => { setPayout(null); load() }} />}
    </div>
  )
}

function PayDialog({ ctx, row, onClose, onDone }: { ctx: BookingContext; row: PayRow; onClose: () => void; onDone: () => void }) {
  const [payType, setPayType] = useState<string>(row.payType ?? 'HOURLY')
  const [rate, setRate] = useState(row.payRate != null ? String(row.payRate) : '')
  const [position, setPosition] = useState(row.position ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    if (!(Number(rate) >= 0) || rate === '') return setError('Enter a rate')
    setBusy(true); setError(null)
    try { await api(`/api/staff/members/${row.memberId}/pay`, { method: 'PATCH', json: { payType, payRate: Number(rate), position: position || null } }); toast.success('Pay updated'); onDone() }
    catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Pay for ${row.name}`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Save</button>
      </div>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <select value={payType} onChange={(e) => setPayType(e.target.value)} className={inputCls}><option value="HOURLY">Hourly</option><option value="MONTHLY">Monthly salary</option></select>
          <input type="number" min={0} step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} placeholder={payType === 'HOURLY' ? 'Per hour' : 'Per month'} className={inputCls} />
        </div>
        <input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={60} placeholder="Job title (e.g. Front desk)" className={inputCls} />
        <p className="text-xs text-muted-foreground">{payType === 'HOURLY' ? `Paid for hours worked, in ${ctx.venue.currency}.` : 'A fixed amount per month, pro-rated for part months.'}</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

function PayoutDialog({ ctx, row, from, to, onClose, onDone }: { ctx: BookingContext; row: PayRow; from: string; to: string; onClose: () => void; onDone: () => void }) {
  const [periodStart, setPeriodStart] = useState(from)
  const [periodEnd, setPeriodEnd] = useState(to)
  const [amount, setAmount] = useState(row.balance && row.balance > 0 ? row.balance.toFixed(2) : '')
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function save() {
    if (!(Number(amount) > 0)) return setError('Enter the amount paid')
    setBusy(true); setError(null)
    try { await api(`/api/staff/members/${row.memberId}/payouts`, { method: 'POST', json: { periodStart, periodEnd, amount: Number(amount), method, note: note || null } }); toast.success(`Payout recorded · ${row.name} has been notified`); onDone() }
    catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Record payout to ${row.name}`} subtitle={`Earned ${money(row.gross, ctx.venue.currency)} · paid ${money(row.paid, ctx.venue.currency)} this period`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Record payout</button>
      </div>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">Period from</label><input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={inputCls} /></div>
          <div><label className="block text-xs font-medium text-muted-foreground mb-1">to</label><input type="date" value={periodEnd} min={periodStart} onChange={(e) => setPeriodEnd(e.target.value)} className={inputCls} /></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Amount" className={inputCls} />
          <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Reference (optional)" className={inputCls} />
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}
