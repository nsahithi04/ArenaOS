'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { CalendarDays, Clock, Plus, Trash2, Trophy, Users } from 'lucide-react'
import {
  api, ApiError, Badge, BRAND_GRADIENT, ErrorState, FieldError, fieldCls, fmtDate, fmtTime, FormProblems, hhmm, inputCls, Modal, money, parseHHmm, Spinner, useBookingContext,
  type BookingContext, type Conflict,
} from '@/components/bookings/shared'

type Row = {
  id: string; name: string; sportName: string | null; sportEmoji: string | null; status: Status
  startDate: string; endDate: string; startMin: number; endMin: number; entryType: string; courtNames: string[]
  entries: number; maxEntrants: number | null; entryFee: number; prizePool: number; winnerName: string | null
}
export type Status = 'REGISTRATION' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED'
export type Prize = { label: string; amount: number; paid: boolean }
export type TournamentForEdit = {
  id: string; name: string; description: string | null; sportId: string | null; courtIds: string[]; startDate: string; endDate: string
  startMin: number; endMin: number; entryType: 'SINGLES' | 'DOUBLES' | 'TEAM'; maxEntrants: number | null; entryFee: number; prizes: Prize[]
}

export const STATUS_STYLE: Record<Status, { label: string; bg: string; color: string }> = {
  REGISTRATION: { label: 'Registration open', bg: '#eff6ff', color: '#2563eb' },
  IN_PROGRESS: { label: 'In progress', bg: '#fffbeb', color: '#b45309' },
  COMPLETED: { label: 'Completed', bg: '#f0fdf4', color: '#15803d' },
  CANCELLED: { label: 'Cancelled', bg: '#fff5f5', color: '#dc2626' },
}
export const ENTRY_TYPE_LABEL: Record<string, string> = { SINGLES: 'Singles', DOUBLES: 'Doubles', TEAM: 'Teams' }

export const dateRange = (a: string, b: string) =>
  a === b ? fmtDate(a, { weekday: 'short', month: 'short', day: 'numeric' }) : `${fmtDate(a, { month: 'short', day: 'numeric' })} – ${fmtDate(b, { month: 'short', day: 'numeric', year: 'numeric' })}`

export function TournamentsScreen() {
  const router = useRouter()
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  useEffect(() => {
    if (!ctx) return
    api<{ items: Row[] }>(`/api/tournaments?venueId=${ctx.venue.id}${showAll ? '&status=all' : ''}`).then((d) => setRows(d.items)).catch((e: ApiError) => setError(e.message))
  }, [ctx, showAll, refreshKey])

  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>
  const cur = ctx.venue.currency

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Tournaments</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Knockout events with entries, a bracket, results and prizes. Courts are reserved for the whole event.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show past & cancelled</label>
          {ctx.permissions.canManageVenue && (
            <button onClick={() => setCreating(true)} className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90" style={{ background: BRAND_GRADIENT }}>
              <Plus size={14} /> New Tournament
            </button>
          )}
        </div>
      </div>

      {error ? <ErrorState message={error} onRetry={() => { setError(null); refresh() }} /> : !rows ? (
        <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-border text-center py-16">
          <Trophy size={30} className="mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No tournaments yet.</p>
          {ctx.permissions.canManageVenue && <button onClick={() => setCreating(true)} className="mt-3 text-sm text-primary hover:underline">Set up the first one</button>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((t) => (
            <button key={t.id} onClick={() => router.push(`/tournaments/${t.id}`)}
              className={`text-left bg-white rounded-xl border border-border p-5 hover:border-primary/40 hover:shadow-sm transition-all ${t.status === 'CANCELLED' ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{t.sportEmoji ? `${t.sportEmoji} ` : ''}{t.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{ENTRY_TYPE_LABEL[t.entryType]}{t.sportName ? ` · ${t.sportName}` : ''}</p>
                </div>
                <Badge bg={STATUS_STYLE[t.status].bg} color={STATUS_STYLE[t.status].color}>{STATUS_STYLE[t.status].label}</Badge>
              </div>
              <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <p className="flex items-center gap-2"><CalendarDays size={13} /> {dateRange(t.startDate, t.endDate)}</p>
                <p className="flex items-center gap-2"><Clock size={13} /> {fmtTime(t.startMin)} – {fmtTime(t.endMin)} · {t.courtNames.join(', ')}</p>
                <p className="flex items-center gap-2"><Users size={13} /> {t.entries}{t.maxEntrants ? ` / ${t.maxEntrants}` : ''} entries · {t.entryFee ? `${money(t.entryFee, cur)} entry` : 'Free entry'}</p>
              </div>
              <div className="mt-3 pt-3 border-t border-border flex items-center justify-between text-sm">
                {t.winnerName
                  ? <span className="font-medium text-amber-700 flex items-center gap-1.5"><Trophy size={14} /> {t.winnerName}</span>
                  : <span className="text-muted-foreground">Prize pool</span>}
                <span className="font-semibold">{money(t.prizePool, cur)}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {creating && <TournamentForm ctx={ctx} onClose={() => setCreating(false)} onDone={(id) => { setCreating(false); router.push(`/tournaments/${id}`) }} />}
    </div>
  )
}

export function TournamentForm({ ctx, t, onClose, onDone }: { ctx: BookingContext; t?: TournamentForEdit; onClose: () => void; onDone: (id: string) => void }) {
  const [name, setName] = useState(t?.name ?? '')
  const [description, setDescription] = useState(t?.description ?? '')
  const [sportId, setSportId] = useState(t?.sportId ?? '')
  const [courtIds, setCourtIds] = useState<string[]>(t?.courtIds ?? [])
  const [startDate, setStartDate] = useState(t?.startDate ?? ctx.today)
  const [endDate, setEndDate] = useState(t?.endDate ?? ctx.today)
  const [start, setStart] = useState(hhmm(t?.startMin ?? 9 * 60))
  const [end, setEnd] = useState(hhmm(t?.endMin ?? 18 * 60))
  const [entryType, setEntryType] = useState<'SINGLES' | 'DOUBLES' | 'TEAM'>(t?.entryType ?? 'SINGLES')
  const [maxEntrants, setMaxEntrants] = useState(t?.maxEntrants != null ? String(t.maxEntrants) : '16')
  const [entryFee, setEntryFee] = useState(t ? String(t.entryFee) : '')
  const [prizes, setPrizes] = useState<Prize[]>(t?.prizes ?? [{ label: 'Winner', amount: 0, paid: false }, { label: 'Runner-up', amount: 0, paid: false }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null)
  const [tried, setTried] = useState(false)
  const [serverFields, setServerFields] = useState<Record<string, string>>({})
  const courts = ctx.courts.filter((c) => c.isActive && (!sportId || !c.sportId || c.sportId === sportId))

  function validate() {
    const e: Record<string, string> = {}
    if (!name.trim()) e.name = 'Enter a tournament name'
    if (!courtIds.length) e.courtIds = 'Choose at least one court to reserve'
    if (!startDate) e.startDate = 'Pick the first day'
    if (!endDate) e.endDate = 'Pick the last day'
    else if (startDate && endDate < startDate) e.endDate = 'Last day must be on or after the first day'
    const s = parseHHmm(start), en = parseHHmm(end)
    if (s == null) e.start = 'Enter the daily start time'
    if (en == null) e.end = 'Enter the daily end time'
    else if (s != null && en <= s) e.end = 'Daily end time must be after the start time'
    if (maxEntrants !== '' && !(Number.isInteger(Number(maxEntrants)) && Number(maxEntrants) >= 2)) e.maxEntrants = 'Maximum entries must be 2 or more (or empty for no limit)'
    if (entryFee === '' || !(Number(entryFee) >= 0)) e.entryFee = 'Enter the entry fee (0 if free)'
    prizes.forEach((p, i) => {
      if (!p.label.trim()) e[`prize${i}`] = `Prize ${i + 1} needs a label`
      else if (!(Number(p.amount) >= 0)) e[`prize${i}`] = `Prize "${p.label}" needs an amount of 0 or more`
    })
    return e
  }
  const errs: Record<string, string> = { ...(tried ? validate() : {}), ...serverFields }

  async function save(skipConflicts = false) {
    setTried(true); setServerFields({})
    if (Object.keys(validate()).length) { setError(null); setConflicts(null); return }
    setBusy(true); setError(null)
    const body = {
      venueId: ctx.venue.id, name, description: description || null, sportId: sportId || null, courtIds, startDate, endDate, start, end,
      entryType, maxEntrants: maxEntrants === '' ? null : Number(maxEntrants), entryFee: Number(entryFee),
      prizes: prizes.map((p) => ({ ...p, amount: Number(p.amount) })), skipConflicts,
    }
    try {
      const r = t
        ? await api<{ id: string; sessions: number | null; skipped: number; trimmed?: number }>(`/api/tournaments/${t.id}`, { method: 'PATCH', json: body })
        : await api<{ id: string; sessions: number; skipped: number; trimmed?: number }>('/api/tournaments', { method: 'POST', json: body })
      const around = (r.trimmed ?? 0) + r.skipped
      toast.success(`${t ? 'Tournament updated' : 'Tournament created'}${r.sessions != null ? ' · courts reserved' : ''}${around ? ` around ${around} existing booking${around === 1 ? '' : 's'}/block${around === 1 ? '' : 's'}` : ''}`)
      onDone(r.id)
    } catch (err) {
      const ae = err as ApiError
      const list = (ae.details?.conflicts as Conflict[] | undefined) ?? null
      setConflicts(ae.status === 409 && list ? list : null)
      setServerFields(ae.fields ?? {})
      setError(ae.fields && Object.keys(ae.fields).length ? null : ae.message)
    } finally { setBusy(false) }
  }

  const label = (x: string) => <label className="block text-xs font-medium text-muted-foreground mb-1">{x}</label>
  const toggle = (id: string) => setCourtIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <Modal title={t ? 'Edit tournament' : 'New tournament'} subtitle={`Times in ${ctx.venue.timezone.replace(/_/g, ' ')}`} onClose={onClose} width="max-w-xl"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={() => save(false)} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} {t ? 'Save' : 'Create tournament'}</button>
      </div>}>
      <div className="space-y-4">
        <FormProblems errors={errs} message={error} conflicts={conflicts}
          conflictNote={<>Courts will be reserved only for the free time around these, e.g. 9:00 AM – 5:00 PM and 6:00 PM – 9:00 PM around a 5–6 PM class. Or move/cancel them first.</>}
          action={<button onClick={() => save(true)} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-60">
            {t ? 'Save' : 'Create'} and reserve around {conflicts?.length === 1 ? 'it' : 'them'}
          </button>} />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">{label('Name *')}<input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="e.g. Winter Open" className={fieldCls(errs.name)} aria-invalid={!!errs.name} autoFocus /><FieldError msg={errs.name} /></div>
          <div>{label('Sport')}<select value={sportId} onChange={(e) => setSportId(e.target.value)} className={inputCls}><option value="">Any</option>{ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div>{label('Format')}<select value={entryType} onChange={(e) => setEntryType(e.target.value as typeof entryType)} className={inputCls}><option value="SINGLES">Singles knockout</option><option value="DOUBLES">Doubles knockout</option><option value="TEAM">Team knockout</option></select></div>
        </div>
        <div>{label('Courts reserved *')}
          <div className={`flex flex-wrap gap-2 ${errs.courtIds ? 'rounded-lg ring-2 ring-red-200 bg-red-50/50 p-1.5' : ''}`}>
            {courts.map((c) => (
              <button key={c.id} type="button" onClick={() => toggle(c.id)}
                className={`px-3 py-1.5 rounded-lg border text-sm ${courtIds.includes(c.id) ? 'border-amber-400 bg-amber-50 text-amber-800 font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}>{c.label}</button>
            ))}
            {courts.length === 0 && <p className="text-xs text-muted-foreground">No active courts{sportId ? ' for this sport' : ''}.</p>}
          </div><FieldError msg={errs.courtIds} /></div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>{label('From *')}<input type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); if (endDate < e.target.value) setEndDate(e.target.value) }} className={fieldCls(errs.startDate)} aria-invalid={!!errs.startDate} /><FieldError msg={errs.startDate} /></div>
          <div>{label('To *')}<input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} className={fieldCls(errs.endDate)} aria-invalid={!!errs.endDate} /><FieldError msg={errs.endDate} /></div>
          <div>{label('Daily start *')}<input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className={fieldCls(errs.start)} aria-invalid={!!errs.start} /><FieldError msg={errs.start} /></div>
          <div>{label('Daily end *')}<input type="time" step={300} value={end} onChange={(e) => setEnd(e.target.value)} className={fieldCls(errs.end)} aria-invalid={!!errs.end} /><FieldError msg={errs.end} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>{label('Maximum entries')}<input type="number" min={2} max={256} value={maxEntrants} onChange={(e) => setMaxEntrants(e.target.value)} placeholder="No limit" className={fieldCls(errs.maxEntrants)} aria-invalid={!!errs.maxEntrants} /><FieldError msg={errs.maxEntrants} /></div>
          <div>{label('Entry fee *')}<input type="number" min={0} step="0.01" value={entryFee} onChange={(e) => setEntryFee(e.target.value)} placeholder="0 if free" className={fieldCls(errs.entryFee)} aria-invalid={!!errs.entryFee} /><FieldError msg={errs.entryFee} /></div>
        </div>
        <div>
          {label('Prizes (in finishing order)')}
          <div className="space-y-2">
            {prizes.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input value={p.label} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} maxLength={40} placeholder={i === 0 ? 'Winner' : i === 1 ? 'Runner-up' : 'Semi-finalists'} className={fieldCls(errs[`prize${i}`])} aria-invalid={!!errs[`prize${i}`]} />
                <input type="number" min={0} step="0.01" value={p.amount} onChange={(e) => setPrizes(prizes.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} className={`${inputCls} w-32`} />
                <button type="button" onClick={() => setPrizes(prizes.filter((_, j) => j !== i))} aria-label="Remove prize" className="px-2 rounded-lg border border-border text-muted-foreground hover:bg-muted"><Trash2 size={14} /></button>
              </div>
            ))}
            {prizes.length < 4 && <button type="button" onClick={() => setPrizes([...prizes, { label: prizes.length === 2 ? 'Semi-finalists' : '', amount: 0, paid: false }])} className="text-xs text-primary hover:underline">+ Add prize</button>}
            <p className="text-xs text-muted-foreground">Prize pool: {money(prizes.reduce((s, p) => s + (Number(p.amount) || 0), 0), ctx.venue.currency)}</p>
          </div>
        </div>
        <div>{label('Notes')}<textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={2} placeholder="Rules, format, contact…" className={inputCls} /></div>
        {t && <p className="text-xs text-muted-foreground">Changing courts, dates or times re-reserves court time from today.</p>}

      </div>
    </Modal>
  )
}
