'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ArrowLeft, CalendarDays, Check, Clock, Medal, Pencil, Plus, Shuffle, Trophy, UserMinus, UserPlus, Users, Wallet } from 'lucide-react'
import {
  api, ApiError, Badge, BRAND_GRADIENT, ConfirmDialog, ErrorState, FieldError, fieldCls, fmtDate, FormProblems, fmtTime, hhmm, inputCls, METHODS, Modal, money, Spinner, useBookingContext,
  type BookingContext, type PaymentMethod,
} from '@/components/bookings/shared'
import { PlayerPicker, playerPayload, type PlayerChoice } from '@/components/club/player-picker'
import { dateRange, ENTRY_TYPE_LABEL, STATUS_STYLE, TournamentForm, type Prize, type Status } from './tournaments-screen'

type Entrant = { id: string; name: string; playerId: string | null; phone: string | null; seed: number | null; withdrawn: boolean; paid: number; balance: number }
type Match = {
  id: string; round: number; position: number; status: 'PENDING' | 'COMPLETED'; score: string | null
  entrantAId: string | null; entrantBId: string | null; winnerId: string | null; entrantA: string | null; entrantB: string | null
  courtId: string | null; date: string | null; startMin: number | null
}
type Detail = {
  id: string; name: string; description: string | null; sportId: string | null; sportName: string | null; courtIds: string[]
  startDate: string; endDate: string; startMin: number; endMin: number; entryType: 'SINGLES' | 'DOUBLES' | 'TEAM'
  maxEntrants: number | null; entryFee: number; prizes: Prize[]; prizePool: number; status: Status; currency: string
  upcomingSessions: number; totalRounds: number; winnerName: string | null
  entrants: Entrant[]
  rounds: { round: number; name: string; matches: Match[] }[]
  placings: { place: number; label: string; names: string[]; prize: Prize | null }[]
}
type Tab = 'bracket' | 'entries' | 'results'

const CARD_H = 76 // px per first-round match slot

export function TournamentDetail({ id }: { id: string }) {
  const router = useRouter()
  const { ctx, error: ctxError, loading: ctxLoading, reload } = useBookingContext()
  const [t, setT] = useState<Detail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('entries')
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [match, setMatch] = useState<Match | null>(null)
  const [paying, setPaying] = useState<Entrant | null>(null)
  const [withdrawing, setWithdrawing] = useState<Entrant | null>(null)
  const [confirmDraw, setConfirmDraw] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api<Detail>(`/api/tournaments/${id}`)
      .then((d) => { setT(d); setTab((cur) => (cur === 'entries' && d.status !== 'REGISTRATION' && d.rounds.length ? 'bracket' : cur)) })
      .catch((e: ApiError) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? 'Unable to load'} onRetry={reload} /></div>
  if (error) return <div className="p-6"><ErrorState message={error} onRetry={() => { setError(null); load() }} /></div>
  if (!t) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>

  const cur = t.currency
  const canEdit = ctx.permissions.canEditBookings
  const canManage = ctx.permissions.canManageVenue
  const active = t.entrants.filter((e) => !e.withdrawn)
  const resultsIn = t.rounds.some((r) => r.matches.some((m) => m.status === 'COMPLETED' && m.score !== 'Bye'))
  const canDraw = canManage && (t.status === 'REGISTRATION' || (t.status === 'IN_PROGRESS' && !resultsIn)) && active.length >= 2
  const courtName = (cid: string | null) => (cid ? ctx.courts.find((c) => c.id === cid)?.label ?? 'Court' : null)
  const collected = t.entrants.reduce((s, e) => s + e.paid, 0)

  async function doDraw() {
    setBusy(true)
    try {
      await api(`/api/tournaments/${id}/draw`, { method: 'POST', json: { random: true } })
      toast.success(t!.status === 'REGISTRATION' ? 'Draw made: registration is closed' : 'Redrawn')
      setTab('bracket')
      load()
    } catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false); setConfirmDraw(false) }
  }

  async function doReopen() {
    setBusy(true)
    try {
      await api(`/api/tournaments/${id}/draw`, { method: 'DELETE' })
      toast.success('Registration reopened: add entries, then make the draw again')
      setTab('entries')
      load()
    } catch (e) { toast.error((e as ApiError).message) } finally { setBusy(false); setConfirmReopen(false) }
  }

  async function togglePrizePaid(i: number) {
    const prizes = t!.prizes.map((p, j) => (j === i ? { ...p, paid: !p.paid } : p))
    try {
      await api(`/api/tournaments/${id}`, { method: 'PATCH', json: { prizes } })
      load()
    } catch (e) { toast.error((e as ApiError).message) }
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <button onClick={() => router.push('/tournaments')} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft size={14} /> Tournaments</button>

      {/* Header */}
      <div className="bg-white rounded-xl border border-border p-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold text-foreground">{t.name}</h1>
              <Badge bg={STATUS_STYLE[t.status].bg} color={STATUS_STYLE[t.status].color}>{STATUS_STYLE[t.status].label}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span className="flex items-center gap-1.5"><CalendarDays size={13} /> {dateRange(t.startDate, t.endDate)}</span>
              <span className="flex items-center gap-1.5"><Clock size={13} /> {fmtTime(t.startMin)} – {fmtTime(t.endMin)} · {t.courtIds.map(courtName).join(', ')}</span>
              <span className="flex items-center gap-1.5"><Users size={13} /> {ENTRY_TYPE_LABEL[t.entryType]} · {active.length}{t.maxEntrants ? ` / ${t.maxEntrants}` : ''} entries</span>
            </div>
            {t.description && <p className="text-sm text-muted-foreground mt-2 whitespace-pre-line">{t.description}</p>}
          </div>
          <div className="flex gap-6 text-sm flex-shrink-0">
            <div><p className="text-muted-foreground text-xs">Entry fee</p><p className="font-semibold">{t.entryFee ? money(t.entryFee, cur) : 'Free'}</p></div>
            <div><p className="text-muted-foreground text-xs">Fees collected</p><p className="font-semibold">{money(collected, cur)}</p></div>
            <div><p className="text-muted-foreground text-xs">Prize pool</p><p className="font-semibold">{money(t.prizePool, cur)}</p></div>
          </div>
        </div>

        {t.winnerName && (
          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 flex items-center gap-3">
            <Trophy size={20} className="text-amber-600" />
            <div><p className="text-xs text-amber-700">Champion</p><p className="font-semibold text-amber-900">{t.winnerName}</p></div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {canDraw && (
            <button onClick={() => setConfirmDraw(true)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-60" style={{ background: BRAND_GRADIENT }}>
              <Shuffle size={13} /> {t.status === 'REGISTRATION' ? 'Make the draw' : 'Redraw'}
            </button>
          )}
          {canManage && t.status === 'IN_PROGRESS' && !resultsIn && (
            <button onClick={() => setConfirmReopen(true)} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted disabled:opacity-60">
              <UserPlus size={13} /> Reopen registration
            </button>
          )}
          {canManage && t.status !== 'CANCELLED' && t.status !== 'COMPLETED' && (
            <>
              <button onClick={() => setEditing(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border border-border hover:bg-muted"><Pencil size={13} /> Edit</button>
              <button onClick={() => setCancelling(true)} className="px-3 py-2 rounded-lg text-xs font-medium text-red-600 border border-red-200 hover:bg-red-50">Cancel tournament</button>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-white rounded-xl border border-border p-1 w-fit">
        {([['bracket', 'Bracket'], ['entries', `Entries (${active.length})`], ['results', 'Results & prizes']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-3 py-2 rounded-lg text-sm font-medium ${tab === k ? 'bg-primary text-white' : 'text-muted-foreground hover:text-foreground hover:bg-muted'}`}>{label}</button>
        ))}
      </div>

      {tab === 'bracket' && (
        t.rounds.length === 0 ? (
          <div className="bg-white rounded-xl border border-border text-center py-14">
            <Shuffle size={28} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">The draw hasn&apos;t been made yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Add at least 2 entries, set any seeds, then make the draw. Registration closes at the draw.</p>
          </div>
        ) : (
          <Bracket t={t} canEdit={canEdit && t.status !== 'CANCELLED'} courtName={courtName} onPick={setMatch} />
        )
      )}

      {tab === 'entries' && (
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <p className="text-sm text-muted-foreground">{t.status === 'REGISTRATION' ? 'Seeds 1, 2, 3… are kept apart in the draw. Unseeded entries are drawn at random.' : resultsIn ? 'Entries are locked: results have been recorded.' : 'Entries are locked because the draw has been made. Use Reopen registration to change them.'}</p>
            {canEdit && t.status === 'REGISTRATION' && (
              <button onClick={() => setAdding(true)} disabled={t.maxEntrants != null && active.length >= t.maxEntrants}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50" style={{ background: BRAND_GRADIENT }}>
                <Plus size={13} /> {t.maxEntrants != null && active.length >= t.maxEntrants ? 'Full' : 'Add entry'}
              </button>
            )}
          </div>
          {t.entrants.length === 0 ? <p className="text-sm text-muted-foreground text-center py-12">No entries yet.</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[600px] whitespace-nowrap">
                <thead><tr className="bg-muted/40">{['Seed', 'Entry', 'Phone', 'Entry fee', ''].map((h) => <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">{h}</th>)}</tr></thead>
                <tbody>
                  {t.entrants.map((e) => (
                    <tr key={e.id} className={`border-t border-border ${e.withdrawn ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-2.5 text-sm">
                        {canEdit && t.status === 'REGISTRATION' && !e.withdrawn
                          ? <SeedInput entrant={e} tournamentId={id} onSaved={load} />
                          : e.seed ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-sm font-medium">{e.name}{e.withdrawn && <span className="text-xs text-muted-foreground font-normal"> · withdrawn</span>}</td>
                      <td className="px-4 py-2.5 text-sm text-muted-foreground">{e.phone ?? '—'}</td>
                      <td className="px-4 py-2.5 text-sm">
                        {t.entryFee === 0 ? <span className="text-muted-foreground">Free</span>
                          : e.balance > 0 ? <span className="text-amber-700">{money(e.balance, cur)} due</span>
                          : <span className="text-green-700 flex items-center gap-1"><Check size={13} /> Paid</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex gap-1 justify-end">
                          {canEdit && e.balance > 0 && !e.withdrawn && <button onClick={() => setPaying(e)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-700 hover:bg-green-50"><Wallet size={12} /> Payment</button>}
                          {canEdit && t.status === 'REGISTRATION' && !e.withdrawn && <button onClick={() => setWithdrawing(e)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50"><UserMinus size={12} /> Withdraw</button>}
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

      {tab === 'results' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl border border-border p-5">
            <h3 className="font-medium mb-3">Final placings</h3>
            {t.placings.length === 0 ? <p className="text-sm text-muted-foreground">Placings appear as the later rounds are played.</p> : (
              <ul className="space-y-3">
                {t.placings.map((p) => (
                  <li key={p.place} className="flex items-start gap-3">
                    <Medal size={18} className={p.place === 1 ? 'text-amber-500' : p.place === 2 ? 'text-slate-400' : 'text-orange-400'} />
                    <div className="flex-1 min-w-0"><p className="text-xs text-muted-foreground">{p.label}</p><p className="text-sm font-medium">{p.names.join(', ')}</p></div>
                    {p.prize && <span className="text-sm font-semibold">{money(p.prize.amount, cur)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="bg-white rounded-xl border border-border p-5">
            <h3 className="font-medium mb-3">Prizes</h3>
            {t.prizes.length === 0 ? <p className="text-sm text-muted-foreground">No prizes set.</p> : (
              <ul className="divide-y divide-border">
                {t.prizes.map((p, i) => (
                  <li key={i} className="flex items-center justify-between py-2 gap-3">
                    <span className="text-sm">{p.label}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold">{money(p.amount, cur)}</span>
                      {ctx.permissions.canManageVenue && t.status === 'COMPLETED' ? (
                        <button onClick={() => togglePrizePaid(i)} className={`px-2 py-1 rounded-md text-xs font-medium border ${p.paid ? 'bg-green-50 text-green-700 border-green-200' : 'border-border text-muted-foreground hover:bg-muted'}`}>
                          {p.paid ? 'Paid out' : 'Mark paid'}
                        </button>
                      ) : p.paid ? <span className="text-xs text-green-700">Paid out</span> : null}
                    </div>
                  </li>
                ))}
                <li className="flex items-center justify-between pt-2"><span className="text-sm text-muted-foreground">Total</span><span className="text-sm font-semibold">{money(t.prizePool, cur)}</span></li>
              </ul>
            )}
            <p className="text-xs text-muted-foreground mt-3">Prize payouts are tracked here only; they aren&apos;t deducted from revenue figures.</p>
          </div>
        </div>
      )}

      {editing && <TournamentForm ctx={ctx} t={t} onClose={() => setEditing(false)} onDone={() => { setEditing(false); load() }} />}
      {adding && <AddEntry ctx={ctx} t={t} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />}
      {match && <MatchDialog ctx={ctx} t={t} match={match} onClose={() => setMatch(null)} onDone={() => { setMatch(null); load() }} />}
      {paying && <EntryPayment t={t} entrant={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); load() }} />}
      {withdrawing && (
        <ConfirmDialog title={`Withdraw ${withdrawing.name}?`} message="They're removed from the tournament before the draw. Any fee paid stays on record." confirmLabel="Withdraw" danger
          onCancel={() => setWithdrawing(null)}
          onConfirm={async () => {
            try { await api(`/api/tournaments/${id}/entrants/${withdrawing.id}`, { method: 'PATCH', json: { withdrawn: true } }); toast.success('Entry withdrawn'); load() }
            catch (e) { toast.error((e as ApiError).message) }
            setWithdrawing(null)
          }} />
      )}
      {confirmDraw && (
        <ConfirmDialog title={t.status === 'REGISTRATION' ? 'Make the draw?' : 'Redraw the bracket?'}
          message={<>{active.length} entries go into a knockout bracket. Seeded entries are placed first; the rest are drawn at random.{t.status === 'REGISTRATION' && ' Registration closes.'}</>}
          confirmLabel={t.status === 'REGISTRATION' ? 'Make the draw' : 'Redraw'} busy={busy}
          onCancel={() => setConfirmDraw(false)} onConfirm={doDraw} />
      )}
      {confirmReopen && (
        <ConfirmDialog title="Reopen registration?"
          message="The current bracket is cleared so you can add, edit or withdraw entries. Entries and fees are kept. Make the draw again when you're ready."
          confirmLabel="Reopen registration" busy={busy}
          onCancel={() => setConfirmReopen(false)} onConfirm={doReopen} />
      )}
      {cancelling && (
        <ConfirmDialog title={`Cancel ${t.name}?`} message={`The courts are released for booking. Entries, fees and results stay on record.`} confirmLabel="Cancel tournament" danger
          onCancel={() => setCancelling(false)}
          onConfirm={async () => {
            try { await api(`/api/tournaments/${id}`, { method: 'DELETE' }); toast.success('Tournament cancelled'); load() }
            catch (e) { toast.error((e as ApiError).message) }
            setCancelling(false)
          }} />
      )}
    </div>
  )
}

// ─── Bracket ────────────────────────────────────────────────────────────────

function Bracket({ t, canEdit, courtName, onPick }: { t: Detail; canEdit: boolean; courtName: (id: string | null) => string | null; onPick: (m: Match) => void }) {
  const firstRound = t.rounds[0]?.matches.length ?? 1
  const height = Math.max(firstRound * CARD_H, CARD_H)
  const last = t.rounds.length - 1
  return (
    <div className="bg-white rounded-xl border border-border p-4 overflow-x-auto">
      <div className="flex gap-8 min-w-max">
        {t.rounds.map((r, ri) => {
          const pairs: Match[][] = []
          for (let i = 0; i < r.matches.length; i += 2) pairs.push(r.matches.slice(i, i + 2))
          return (
            <div key={r.round} className="w-56 flex flex-col">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3 text-center">{r.name}</p>
              <div className="flex flex-col" style={{ height }}>
                {pairs.map((pair, pi) => (
                  <div key={pi} className="relative flex-1 flex flex-col justify-around">
                    {pair.map((m) => <MatchCard key={m.id} m={m} hasLeftLink={ri > 0} canEdit={canEdit} courtName={courtName} onPick={onPick} isFinal={ri === last} />)}
                    {ri < last && pair.length === 2 && (
                      <div className="absolute -right-4 w-4 border-y border-r border-slate-300 rounded-r-md pointer-events-none" style={{ top: '25%', bottom: '25%' }} />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MatchCard({ m, hasLeftLink, canEdit, courtName, onPick, isFinal }: {
  m: Match; hasLeftLink: boolean; canEdit: boolean; courtName: (id: string | null) => string | null; onPick: (m: Match) => void; isFinal: boolean
}) {
  const bye = m.score === 'Bye'
  const ready = !!(m.entrantAId && m.entrantBId)
  const clickable = canEdit && !bye && (ready || m.status === 'COMPLETED')
  const row = (name: string | null, id: string | null) => {
    const won = m.status === 'COMPLETED' && m.winnerId === id && !!id
    return (
      <div className={`flex items-center justify-between gap-2 px-2.5 py-1 text-sm ${won ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        <span className="truncate">{name ?? (bye ? 'Bye' : 'TBD')}</span>
        {won && (isFinal ? <Trophy size={12} className="text-amber-500 flex-shrink-0" /> : <Check size={12} className="text-green-600 flex-shrink-0" />)}
      </div>
    )
  }
  return (
    <div className="relative">
      {hasLeftLink && <div className="absolute -left-4 top-1/2 w-4 border-t border-slate-300 pointer-events-none" />}
      <button type="button" disabled={!clickable} onClick={() => onPick(m)}
        className={`w-full text-left rounded-lg border bg-white ${m.status === 'COMPLETED' ? 'border-slate-200' : ready ? 'border-amber-300' : 'border-dashed border-slate-200'} ${clickable ? 'hover:shadow-md hover:border-primary/50' : ''} ${bye ? 'opacity-60' : ''}`}>
        {row(m.entrantA, m.entrantAId)}
        <div className="border-t border-slate-100" />
        {row(m.entrantB, m.entrantBId)}
        {(m.score && !bye) || m.date ? (
          <div className="px-2.5 pb-1 text-[10px] text-muted-foreground truncate">
            {m.score && !bye ? m.score : ''}{m.score && !bye && m.date ? ' · ' : ''}
            {m.date ? `${fmtDate(m.date, { month: 'short', day: 'numeric' })} ${m.startMin != null ? fmtTime(m.startMin) : ''}${m.courtId ? ` · ${courtName(m.courtId)}` : ''}` : ''}
          </div>
        ) : null}
      </button>
    </div>
  )
}

function MatchDialog({ ctx, t, match, onClose, onDone }: { ctx: BookingContext; t: Detail; match: Match; onClose: () => void; onDone: () => void }) {
  const [winnerId, setWinnerId] = useState<string | null>(match.winnerId)
  const [score, setScore] = useState(match.score && match.score !== 'W/O' ? match.score : '')
  const [walkover, setWalkover] = useState(match.score === 'W/O')
  const [courtId, setCourtId] = useState(match.courtId ?? '')
  const [date, setDate] = useState(match.date ?? t.startDate)
  const [time, setTime] = useState(match.startMin != null ? hhmm(match.startMin) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ready = !!(match.entrantAId && match.entrantBId)
  const roundName = t.rounds.find((r) => r.round === match.round)?.name ?? ''

  async function send(body: Record<string, unknown>, msg: string) {
    setBusy(true); setError(null)
    try { await api(`/api/tournaments/${t.id}/matches/${match.id}`, { method: 'PATCH', json: body }); toast.success(msg); onDone() }
    catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  function save() {
    const body: Record<string, unknown> = {}
    if (courtId || time) Object.assign(body, { courtId: courtId || null, date: time ? date : null, start: time || null })
    else if (match.courtId || match.date) Object.assign(body, { courtId: null, date: null, start: null })
    const newScore = walkover ? 'W/O' : score.trim() || null
    const resultChanged = !!winnerId && (winnerId !== match.winnerId || newScore !== match.score)
    if (resultChanged) Object.assign(body, { winnerId, score: walkover ? null : score.trim() || null, walkover })
    if (!Object.keys(body).length) return onClose()
    send(body, body.winnerId ? (match.round === t.totalRounds ? 'Champion crowned 🏆' : 'Result saved') : 'Match scheduled')
  }

  return (
    <Modal title={`${roundName} · Match ${match.position + 1}`} onClose={onClose} width="max-w-md"
      footer={<div className="flex items-center justify-between gap-2">
        <div>{match.status === 'COMPLETED' && <button onClick={() => send({ undo: true }, 'Result removed')} disabled={busy} className="text-xs text-red-600 hover:underline">Undo result</button>}</div>
        <div className="flex gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
          <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Save</button>
        </div>
      </div>}>
      <div className="space-y-4">
        {ready ? (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Winner</label>
            <div className="grid grid-cols-2 gap-2">
              {[[match.entrantAId!, match.entrantA!], [match.entrantBId!, match.entrantB!]].map(([eid, name]) => (
                <button key={eid} type="button" onClick={() => setWinnerId(eid)}
                  className={`px-3 py-3 rounded-lg border text-sm text-left ${winnerId === eid ? 'border-green-500 bg-green-50 text-green-800 font-semibold' : 'border-border hover:bg-muted'}`}>
                  {winnerId === eid && <Check size={13} className="inline mr-1" />}{name}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 items-center">
              <input value={score} onChange={(e) => setScore(e.target.value)} disabled={walkover} maxLength={60} placeholder="Score, e.g. 21-17, 21-19" className={`${inputCls} col-span-2`} />
              <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={walkover} onChange={(e) => setWalkover(e.target.checked)} /> Walkover</label>
            </div>
          </div>
        ) : <p className="text-sm text-muted-foreground">Waiting for the previous round. You can still schedule this match.</p>}

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">Schedule (optional)</label>
          <div className="grid grid-cols-3 gap-2">
            <select value={courtId} onChange={(e) => setCourtId(e.target.value)} className={inputCls}>
              <option value="">Court…</option>
              {t.courtIds.map((cid) => <option key={cid} value={cid}>{ctx.courts.find((c) => c.id === cid)?.label ?? 'Court'}</option>)}
            </select>
            <input type="date" value={date} min={t.startDate} max={t.endDate} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            <input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </Modal>
  )
}

function AddEntry({ ctx, t, onClose, onDone }: { ctx: BookingContext; t: Detail; onClose: () => void; onDone: () => void }) {
  const team = t.entryType !== 'SINGLES'
  const [player, setPlayer] = useState<PlayerChoice>(null)
  const [name, setName] = useState('')
  const [seed, setSeed] = useState('')
  const [takePayment, setTakePayment] = useState(t.entryFee > 0)
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(String(t.entryFee))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  // Same person already in (not withdrawn): same player, name or phone. Checked live.
  const key = (x: string) => x.trim().replace(/\s+/g, ' ').toLowerCase()
  const digits = (x: string | null | undefined) => (x ?? '').replace(/\D/g, '').slice(-10)
  const active = t.entrants.filter((e) => !e.withdrawn)
  const pName = player?.kind === 'existing' ? player.player.name : player?.kind === 'new' ? player.name : ''
  const pPhone = player?.kind === 'existing' ? player.player.phone : player?.kind === 'new' ? player.phone : ''
  const playerDup = player && active.find((e) =>
    (player.kind === 'existing' && e.playerId === player.player.id)
    || (!team && pName.trim() && key(e.name) === key(pName))
    || (digits(pPhone).length >= 7 && digits(e.phone) === digits(pPhone)))
  const teamDup = team && name.trim() ? active.find((e) => key(e.name) === key(name)) : undefined

  function validate() {
    const e: Record<string, string> = {}
    if (team && !name.trim()) e.name = t.entryType === 'DOUBLES' ? 'Enter the pair name, e.g. "Asha / Ravi"' : 'Enter the team name'
    if (!team && !player) e.player = 'Choose or add the player'
    if (player?.kind === 'new' && !player.name.trim()) e.player = 'Enter the player name'
    return e
  }
  const errs: Record<string, string> = { ...(tried ? validate() : {}) }
  if (teamDup) errs.name = `"${teamDup.name}" is already entered in this tournament.`
  if (playerDup) errs.player = `${pName.trim() || 'This player'} is already entered${key(playerDup.name) !== key(pName) ? ` (as ${playerDup.name})` : ''}.`

  async function save() {
    setTried(true)
    if (Object.keys(validate()).length || teamDup || playerDup) { setError(null); return }
    setBusy(true); setError(null)
    try {
      await api(`/api/tournaments/${t.id}/entrants`, {
        method: 'POST',
        json: { ...playerPayload(player), name: team ? name : undefined, seed: seed || null, payment: takePayment ? { amount: Number(amount), method } : null },
      })
      toast.success('Entry added')
      onDone()
    } catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }

  return (
    <Modal title="Add entry" subtitle={t.name} onClose={onClose} width="max-w-md"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={save} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Add entry</button>
      </div>}>
      <div className="space-y-4">
        <FormProblems errors={errs} message={error} />
        {team && (
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t.entryType === 'DOUBLES' ? 'Pair name *' : 'Team name *'}</label>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder={t.entryType === 'DOUBLES' ? 'Asha / Ravi' : 'Desert Smashers'} className={fieldCls(errs.name)} aria-invalid={!!errs.name} autoFocus />
            <FieldError msg={errs.name} />
          </div>
        )}
        <div className={errs.player ? 'rounded-lg ring-2 ring-red-200 bg-red-50/40 p-2' : ''}>
          <PlayerPicker ctx={ctx} value={player} onChange={setPlayer} label={team ? 'Contact player (optional)' : 'Player *'} />
          <FieldError msg={errs.player} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Seed (optional)</label>
            <input type="number" min={1} max={256} value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="None" className={inputCls} />
          </div>
        </div>
        {t.entryFee > 0 && (
          <div className="rounded-lg border border-border p-3 space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} /> Entry fee paid now ({money(t.entryFee, t.currency)})</label>
            {takePayment && (
              <div className="grid grid-cols-2 gap-2">
                <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
                <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

function EntryPayment({ t, entrant, onClose, onDone }: { t: Detail; entrant: Entrant; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(entrant.balance.toFixed(2))
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function pay() {
    const n = Number(amount)
    if (!(n > 0) || n > entrant.balance) return setError(`Enter up to ${money(entrant.balance, t.currency)}`)
    setBusy(true); setError(null)
    try { await api(`/api/tournaments/${t.id}/entrants/${entrant.id}/payments`, { method: 'POST', json: { amount: n, method } }); toast.success('Payment recorded'); onDone() }
    catch (e) { setError((e as ApiError).message) } finally { setBusy(false) }
  }
  return (
    <Modal title="Record entry fee" subtitle={`${entrant.name} · ${t.name}`} onClose={onClose} width="max-w-sm"
      footer={<div className="flex justify-end gap-2">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
        <button onClick={pay} disabled={busy} className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-60 flex items-center gap-2" style={{ background: BRAND_GRADIENT }}>{busy && <Spinner />} Record payment</button>
      </div>}>
      <div className="grid grid-cols-2 gap-2">
        <input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} />
        <select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} className={inputCls}>{METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select>
      </div>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </Modal>
  )
}

function SeedInput({ entrant, tournamentId, onSaved }: { entrant: Entrant; tournamentId: string; onSaved: () => void }) {
  const [v, setV] = useState(entrant.seed != null ? String(entrant.seed) : '')
  async function commit() {
    const next = v === '' ? null : Number(v)
    if (next === entrant.seed) return
    try { await api(`/api/tournaments/${tournamentId}/entrants/${entrant.id}`, { method: 'PATCH', json: { seed: next } }); onSaved() }
    catch (e) { toast.error((e as ApiError).message); setV(entrant.seed != null ? String(entrant.seed) : '') }
  }
  return <input type="number" min={1} max={256} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} placeholder="—" aria-label={`Seed for ${entrant.name}`} className="w-14 px-2 py-1 rounded-md border border-border text-sm" />
}
