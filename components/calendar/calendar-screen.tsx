'use client'
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Wrench, User, Clock, CalendarPlus } from "lucide-react";
import {
  addDays, api, ApiError, BRAND_GRADIENT, clockToMin, ConfirmDialog, dayName, ErrorState, fmtDate, fmtDuration, fmtTime, hhmm,
  inputCls, Modal, money, nowMinutesIn, sourceLabel, Spinner, STATUS, useBookingContext, weekStart, bookingLockReason,
  type Booking, type BookingContext, type BookingStatus, type CourtBlock,
} from "@/components/bookings/shared";
import { BookingForm, type BookingFormMode, type BookingFormPrefill } from "@/components/bookings/booking-form";
import { BookingDetails } from "@/components/bookings/booking-details";

type View = "day" | "week" | "month";
type StatusFilter = "all" | BookingStatus | "walkin";

const SLOT_HEIGHT = 56; // px per hour
const MAINT = { bg: "#f8fafc", border: "#cbd5e1", text: "#475569", label: "Maintenance" };

type Column = { key: string; date: string; courtId: string; courtName: string; dayLabel?: string; groupStart?: boolean };

function formatHour(h: number) {
  const hh = h % 24;
  if (hh === 0) return "12 AM";
  if (hh === 12) return "12 PM";
  return hh < 12 ? `${hh} AM` : `${hh - 12} PM`;
}

/** Open window for a court's sport on a date: sport rows, else venue-wide rows. null = not configured. */
function courtWindow(ctx: BookingContext, courtId: string, date: string): { open: number; close: number } | null {
  const sportId = ctx.courts.find((c) => c.id === courtId)?.sportId ?? null;
  const day = dayName(date);
  const forDay = ctx.hours.filter((h) => h.day === day);
  const specific = forDay.filter((h) => sportId && h.sportId === sportId);
  const rows = specific.length ? specific : forDay.filter((h) => h.sportId === null);
  if (!rows.length) return null;
  const open = rows.filter((r) => !r.isClosed);
  if (!open.length) return { open: 0, close: 0 };
  return {
    open: Math.min(...open.map((r) => clockToMin(r.openTime) ?? 0)),
    close: Math.max(...open.map((r) => clockToMin(r.closeTime, true) ?? 1440)),
  };
}

export function CalendarScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload: reloadCtx } = useBookingContext();
  const [view, setView] = useState<View>("day");
  const [date, setDate] = useState<string | null>(null);
  const [sportFilter, setSportFilter] = useState("");
  const [courtFilter, setCourtFilter] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<CourtBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [selected, setSelected] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ courtId: string; date: string; startMin: number } | null>(null);
  const [form, setForm] = useState<{ mode: BookingFormMode; prefill?: BookingFormPrefill } | null>(null);
  const [blockForm, setBlockForm] = useState<{ courtId: string; date: string; startMin: number } | null>(null);
  const [removeBlock, setRemoveBlock] = useState<CourtBlock | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (ctx && !date) setDate(ctx.today); }, [ctx, date]);

  const range = useMemo(() => {
    if (!date) return null;
    if (view === "day") return { from: date, to: date };
    if (view === "week") { const s = weekStart(date); return { from: s, to: addDays(s, 6) }; }
    const first = `${date.slice(0, 8)}01`;
    const s = weekStart(first);
    return { from: s, to: addDays(s, 41) };
  }, [date, view]);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!ctx || !range) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ venueId: ctx.venue.id, from: range.from, to: range.to, pageSize: "2000", order: "asc" });
    if (courtFilter) p.set("courtId", courtFilter);
    if (sportFilter) p.set("sportId", sportFilter);
    Promise.all([
      api<{ items: Booking[] }>(`/api/bookings?${p}`),
      api<CourtBlock[]>(`/api/court-blocks?venueId=${ctx.venue.id}&from=${range.from}&to=${range.to}`),
    ])
      .then(([b, bl]) => { if (!cancelled) { setBookings(b.items); setBlocks(bl); } })
      .catch((e: ApiError) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ctx, range, courtFilter, sportFilter, refreshKey]);

  const courts = useMemo(() => {
    if (!ctx) return [];
    return ctx.courts.filter((c) => c.isActive && (!courtFilter || c.id === courtFilter) && (!sportFilter || !c.sportId || c.sportId === sportFilter));
  }, [ctx, courtFilter, sportFilter]);

  const visible = useMemo(() => bookings.filter((b) => {
    if (filterStatus === "all") return b.status !== "CANCELLED";
    if (filterStatus === "walkin") return b.source === "WALK_IN" && b.status !== "CANCELLED";
    return b.status === filterStatus;
  }), [bookings, filterStatus]);

  if (ctxLoading || (ctx && !date)) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>;
  if (ctxError || !ctx || !date || !range) return <div className="p-6"><ErrorState message={ctxError ?? "Unable to load calendar"} onRetry={reloadCtx} /></div>;

  const canEdit = ctx.permissions.canEditBookings;
  const step = (dir: number) => {
    if (view === "day") setDate(addDays(date, dir));
    else if (view === "week") setDate(addDays(date, 7 * dir));
    else {
      const [y, m] = date.split("-").map(Number);
      const d = new Date(Date.UTC(y, m - 1 + dir, 1));
      setDate(d.toISOString().slice(0, 10));
    }
  };
  const title =
    view === "day" ? fmtDate(date, { weekday: "short", month: "short", day: "numeric", year: "numeric" })
    : view === "week" ? `${fmtDate(range.from, { month: "short", day: "numeric" })} – ${fmtDate(range.to, { month: "short", day: "numeric", year: "numeric" })}`
    : fmtDate(date, { month: "long", year: "numeric" });

  // Columns for the time grid
  const days = view === "day" ? [date] : view === "week" ? Array.from({ length: 7 }, (_, i) => addDays(range.from, i)) : [];
  const columns: Column[] = days.flatMap((d) => courts.map((c, i) => ({
    key: `${d}:${c.id}`, date: d, courtId: c.id, courtName: c.name,
    dayLabel: view === "week" && i === 0 ? d : undefined, groupStart: view === "week" && i === 0,
  })));

  // Visible hours: union of open windows, widened to include any booking/block, default 6–22.
  let startH = 24, endH = 0;
  for (const col of columns) {
    const w = courtWindow(ctx, col.courtId, col.date);
    if (w && w.close > w.open) { startH = Math.min(startH, Math.floor(w.open / 60)); endH = Math.max(endH, Math.ceil(w.close / 60)); }
  }
  for (const b of visible) if (days.includes(b.date)) { startH = Math.min(startH, Math.floor(b.startMin / 60)); endH = Math.max(endH, Math.ceil(b.endMin / 60)); }
  for (const b of blocks) if (days.includes(b.date)) { startH = Math.min(startH, Math.floor(b.startMin / 60)); endH = Math.max(endH, Math.ceil(b.endMin / 60)); }
  if (startH >= endH) { startH = 6; endH = 22; }
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i);
  const nowMin = nowMinutesIn(ctx.venue.timezone);

  const onSlotClick = (col: Column, e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return;
    const locked = bookingLockReason(ctx, col.date);
    if (locked) { toast.info(locked); return; }
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = startH * 60 + Math.floor(((e.clientY - rect.top) / SLOT_HEIGHT) * 2) * 30;
    setSlot({ courtId: col.courtId, date: col.date, startMin: Math.max(0, Math.min(minute, 1410)) });
  };

  const createBlock = async (courtId: string, d: string, startMin: number, duration: number, reason: string) => {
    setBusy(true);
    try {
      await api("/api/court-blocks", { method: "POST", json: { venueId: ctx.venue.id, courtId, date: d, start: hhmm(startMin), end: hhmm(Math.min(startMin + duration, 1440) % 1440), reason: reason || null } });
      toast.success("Court blocked");
      setBlockForm(null);
      refresh();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(false); }
  };

  const deleteBlock = async (b: CourtBlock) => {
    setBusy(true);
    try {
      await api(`/api/court-blocks/${b.id}`, { method: "DELETE" });
      toast.success("Block removed");
      setRemoveBlock(null);
      refresh();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally { setBusy(false); }
  };

  const legend: [string, { bg: string; border: string; label: string }][] = [
    ...(["CONFIRMED", "PENDING", "CHECKED_IN", "COMPLETED"] as BookingStatus[]).map((s) => [s, STATUS[s]] as [string, typeof STATUS[BookingStatus]]),
    ["maintenance", MAINT],
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 px-4 sm:px-6 py-4 bg-white border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <h1 className="text-lg font-semibold text-foreground">Booking Calendar</h1>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            {(["day", "week", "month"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm capitalize ${view === v ? "font-medium bg-white shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
                {v}
              </button>
            ))}
          </div>
          {loading && <Spinner className="text-muted-foreground" />}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} aria-label="Previous" className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition-colors"><ChevronLeft size={14} /></button>
            <button onClick={() => setDate(ctx.today)} className="px-2.5 h-8 rounded-lg border border-border hover:bg-muted text-xs font-medium">Today</button>
            <span className="text-sm font-medium text-foreground min-w-36 text-center">{title}</span>
            <button onClick={() => step(1)} aria-label="Next" className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition-colors"><ChevronRight size={14} /></button>
          </div>

          <select value={sportFilter} onChange={(e) => { setSportFilter(e.target.value); setCourtFilter(""); }} className="px-3 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20" aria-label="Sport">
            <option value="">All sports</option>
            {ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={courtFilter} onChange={(e) => setCourtFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20" aria-label="Court">
            <option value="">All courts</option>
            {ctx.courts.filter((c) => c.isActive && (!sportFilter || !c.sportId || c.sportId === sportFilter)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusFilter)} className="px-3 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20" aria-label="Status">
            <option value="all">All Bookings</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PENDING">Pending</option>
            <option value="CHECKED_IN">Checked in</option>
            <option value="COMPLETED">Completed</option>
            <option value="walkin">Walk-ins</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          {canEdit && (
            <button onClick={() => setForm({ mode: "create", prefill: { date: view === "day" ? date : undefined } })}
              className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all" style={{ background: BRAND_GRADIENT }}>
              <Plus size={14} /> Add Booking
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 sm:px-6 py-2 bg-white border-b border-border flex-shrink-0 overflow-x-auto">
        {legend.map(([key, s]) => (
          <div key={key} className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-2.5 h-2.5 rounded-sm border" style={{ background: s.bg, borderColor: s.border }} />
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-2.5 h-2.5 rounded-sm" style={{ background: "repeating-linear-gradient(45deg,#e2e8f0,#e2e8f0 2px,#f8fafc 2px,#f8fafc 4px)" }} />
          <span className="text-xs text-muted-foreground">Closed</span>
        </div>
        <span className="text-xs text-muted-foreground ml-auto flex-shrink-0">Times in {ctx.venue.timezone.replace(/_/g, " ")}</span>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : courts.length === 0 && view !== "month" ? (
        <div className="text-center py-16 text-sm text-muted-foreground">
          <CalendarPlus size={28} className="mx-auto mb-3 opacity-50" />
          No courts to show. {ctx.permissions.isOwner ? "Add courts under Venue Settings → Courts." : "Ask the venue owner to add courts."}
        </div>
      ) : view === "month" ? (
        <MonthGrid ctx={ctx} from={range.from} month={date.slice(0, 7)} bookings={visible} onPickDay={(d) => { setDate(d); setView("day"); }} />
      ) : (
        /* Time grid (day + week) */
        <div className="flex-1 overflow-auto">
          <div className="flex min-w-max">
            {/* Time column */}
            <div className="w-16 flex-shrink-0 bg-white border-r border-border sticky left-0 z-20">
              <div className={`${view === "week" ? "h-20" : "h-12"} border-b border-border bg-white sticky top-0 z-30`} />
              {hours.map((h) => (
                <div key={h} className="border-b border-border flex items-start justify-end pr-3 pt-1" style={{ height: SLOT_HEIGHT }}>
                  <span className="text-xs text-muted-foreground">{formatHour(h)}</span>
                </div>
              ))}
            </div>

            {columns.map((col) => {
              const win = courtWindow(ctx, col.courtId, col.date);
              const colBookings = visible.filter((b) => b.courtId === col.courtId && b.date === col.date);
              const colBlocks = blocks.filter((b) => b.courtId === col.courtId && b.date === col.date);
              const gridStart = startH * 60;
              const gridEnd = endH * 60;
              const shade: [number, number][] = [];
              if (win) {
                if (win.close <= win.open) shade.push([gridStart, gridEnd]);
                else {
                  if (win.open > gridStart) shade.push([gridStart, win.open]);
                  if (win.close < gridEnd) shade.push([win.close, gridEnd]);
                }
              }
              const isToday = col.date === ctx.today;
              return (
                <div key={col.key} className={`${view === "week" ? "w-28" : "flex-1 min-w-48"} border-r border-border last:border-r-0 ${col.groupStart ? "border-l-2 border-l-slate-300" : ""}`}>
                  {/* Header */}
                  <div className={`${view === "week" ? "h-20" : "h-12"} border-b border-border bg-white flex flex-col items-center justify-center px-2 sticky top-0 z-10`}>
                    {view === "week" && (
                      <button onClick={() => { setDate(col.date); setView("day"); }} className={`text-xs font-semibold mb-1 hover:underline ${isToday ? "text-primary" : "text-foreground"} ${col.dayLabel ? "" : "invisible"}`}>
                        {fmtDate(col.date, { weekday: "short", day: "numeric" })}
                      </button>
                    )}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${ctx.courts.find((c) => c.id === col.courtId)?.isAvailable === false ? "bg-slate-300" : "bg-green-400"}`} />
                      <span className="text-sm font-medium text-foreground truncate">{col.courtName}</span>
                    </div>
                  </div>

                  {/* Slots */}
                  <div className="relative bg-white" style={{ height: hours.length * SLOT_HEIGHT }}>
                    {hours.map((h) => (
                      <div key={h} className="border-b border-border" style={{ height: SLOT_HEIGHT }} />
                    ))}
                    {shade.map(([a, b], i) => (
                      <div key={i} className="absolute inset-x-0 pointer-events-none"
                        style={{ top: ((a - gridStart) / 60) * SLOT_HEIGHT, height: ((b - a) / 60) * SLOT_HEIGHT, background: "repeating-linear-gradient(45deg,rgba(226,232,240,.7),rgba(226,232,240,.7) 4px,rgba(248,250,252,.7) 4px,rgba(248,250,252,.7) 8px)" }} />
                    ))}
                    {/* Click target */}
                    <div onClick={(e) => onSlotClick(col, e)} className={`absolute inset-0 ${canEdit ? "cursor-pointer hover:bg-green-50/30" : ""}`} />
                    {isToday && nowMin >= gridStart && nowMin <= gridEnd && (
                      <div className="absolute inset-x-0 h-0.5 bg-red-400 z-20 pointer-events-none" style={{ top: ((nowMin - gridStart) / 60) * SLOT_HEIGHT }} />
                    )}

                    {colBlocks.map((bl) => {
                      const top = ((bl.startMin - gridStart) / 60) * SLOT_HEIGHT;
                      const height = ((bl.endMin - bl.startMin) / 60) * SLOT_HEIGHT - 4;
                      return (
                        <div key={bl.id} onClick={() => canEdit && setRemoveBlock(bl)} title={bl.reason ?? "Maintenance"}
                          className={`absolute left-1 right-1 rounded-lg border overflow-hidden z-10 ${canEdit ? "cursor-pointer hover:shadow-md" : ""}`}
                          style={{ top: top + 2, height: Math.max(height, 18), background: MAINT.bg, borderColor: MAINT.border }}>
                          <div className="px-2 py-1 flex items-center gap-1">
                            <Wrench size={10} style={{ color: MAINT.text }} />
                            <span className="text-xs font-semibold truncate" style={{ color: MAINT.text }}>{bl.reason || "Maintenance"}</span>
                          </div>
                        </div>
                      );
                    })}

                    {colBookings.map((b) => {
                      const s = STATUS[b.status];
                      const top = ((b.startMin - gridStart) / 60) * SLOT_HEIGHT;
                      const height = ((b.endMin - b.startMin) / 60) * SLOT_HEIGHT - 4;
                      return (
                        <div key={b.id} onClick={() => setSelected(b.id)}
                          className={`absolute left-1 right-1 rounded-lg border overflow-hidden cursor-pointer hover:shadow-md transition-all z-10 ${b.status === "CANCELLED" ? "opacity-60" : ""}`}
                          style={{ top: top + 2, height: Math.max(height, 18), background: s.bg, borderColor: s.border }}>
                          <div className="w-1 absolute left-0 top-0 bottom-0 rounded-l-lg" style={{ background: s.border }} />
                          <div className="pl-2.5 pr-2 py-1">
                            <div className="flex items-center gap-1 mb-0.5">
                              {b.sportEmoji && <span className="text-xs">{b.sportEmoji}</span>}
                              <span className={`text-xs font-semibold truncate ${b.status === "CANCELLED" ? "line-through" : ""}`} style={{ color: s.color }}>{b.customer}</span>
                            </div>
                            {height > 40 && (
                              <div className="flex items-center gap-1">
                                <Clock size={9} style={{ color: s.color, opacity: 0.7 }} />
                                <span className="text-xs opacity-70 truncate" style={{ color: s.color }}>{fmtTime(b.startMin)} – {fmtTime(b.endMin)}</span>
                              </div>
                            )}
                            {height > 62 && (
                              <span className="text-xs font-medium mt-0.5 block truncate" style={{ color: s.color }}>
                                {sourceLabel(b.source)} · {money(b.amount, ctx.venue.currency)}{b.balance > 0 ? " · due" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && <BookingDetails ctx={ctx} bookingId={selected} onClose={() => setSelected(null)} onChanged={refresh} />}

      {form && (
        <BookingForm ctx={ctx} mode={form.mode} prefill={form.prefill} onClose={() => setForm(null)} onSaved={() => { setForm(null); refresh(); }} />
      )}

      {/* Add-to-slot chooser */}
      {slot && (
        <Modal title="Add to slot" subtitle={`${ctx.courts.find((c) => c.id === slot.courtId)?.name} · ${fmtDate(slot.date)} · ${fmtTime(slot.startMin)}`} onClose={() => setSlot(null)} width="max-w-xs">
          <div className="space-y-2">
            {[
              { icon: CalendarPlus, color: "text-blue-600", hover: "hover:bg-blue-50 hover:border-blue-200", title: "New Booking", sub: "Phone, WhatsApp or aggregator", onClick: () => { setForm({ mode: "create", prefill: { courtId: slot.courtId, date: slot.date, startMin: slot.startMin } }); setSlot(null); } },
              { icon: User, color: "text-green-600", hover: "hover:bg-green-50 hover:border-green-200", title: "Walk-in Booking", sub: "Customer at the desk, take payment", onClick: () => { setForm({ mode: "walkin", prefill: { courtId: slot.courtId, date: slot.date, startMin: slot.startMin } }); setSlot(null); } },
              { icon: Wrench, color: "text-slate-500", hover: "hover:bg-slate-50 hover:border-slate-300", title: "Block for Maintenance", sub: "Mark as unavailable", onClick: () => { setBlockForm(slot); setSlot(null); } },
            ].map((o) => (
              <button key={o.title} onClick={o.onClick} className={`w-full flex items-center gap-3 p-3 rounded-lg border border-border transition-all text-left ${o.hover}`}>
                <o.icon size={16} className={o.color} />
                <div>
                  <p className="text-sm font-medium">{o.title}</p>
                  <p className="text-xs text-muted-foreground">{o.sub}</p>
                </div>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {blockForm && <BlockDialog ctx={ctx} initial={blockForm} busy={busy} onClose={() => setBlockForm(null)} onSubmit={createBlock} />}

      {removeBlock && (
        <ConfirmDialog
          title="Remove this block?"
          message={`${ctx.courts.find((c) => c.id === removeBlock.courtId)?.name} · ${fmtDate(removeBlock.date)} ${fmtTime(removeBlock.startMin)} – ${fmtTime(removeBlock.endMin)}${removeBlock.reason ? ` (${removeBlock.reason})` : ""}. The court becomes bookable again.`}
          confirmLabel="Remove block"
          danger
          busy={busy}
          onCancel={() => setRemoveBlock(null)}
          onConfirm={() => deleteBlock(removeBlock)}
        />
      )}
    </div>
  );
}

function BlockDialog({ ctx, initial, busy, onClose, onSubmit }: {
  ctx: BookingContext
  initial: { courtId: string; date: string; startMin: number }
  busy: boolean
  onClose: () => void
  onSubmit: (courtId: string, date: string, startMin: number, duration: number, reason: string) => void
}) {
  const [start, setStart] = useState(hhmm(initial.startMin));
  const [duration, setDuration] = useState(120);
  const [reason, setReason] = useState("Maintenance");
  const startMin = Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5));
  return (
    <Modal title="Block court" subtitle={`${ctx.courts.find((c) => c.id === initial.courtId)?.name} · ${fmtDate(initial.date)}`} onClose={onClose} width="max-w-sm"
      footer={
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted">Cancel</button>
          <button disabled={busy || startMin + duration > 1440} onClick={() => onSubmit(initial.courtId, initial.date, startMin, duration, reason)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-slate-600 hover:bg-slate-700 disabled:opacity-60 flex items-center gap-2">
            {busy && <Spinner />} Block court
          </button>
        </div>
      }>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Start</label>
            <input type="time" step={300} value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Duration</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputCls}>
              {[30, 60, 90, 120, 180, 240, 360, 480, 720].map((d) => <option key={d} value={d}>{fmtDuration(d)}</option>)}
            </select>
          </div>
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Reason" className={inputCls} />
        {startMin + duration > 1440 && <p className="text-xs text-red-600">Block cannot run past midnight.</p>}
        <p className="text-xs text-muted-foreground">Existing bookings in this window must be moved or cancelled first.</p>
      </div>
    </Modal>
  );
}

function MonthGrid({ ctx, from, month, bookings, onPickDay }: {
  ctx: BookingContext
  from: string
  month: string
  bookings: Booking[]
  onPickDay: (d: string) => void
}) {
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = byDay.get(b.date) ?? [];
    list.push(b);
    byDay.set(b.date, list);
  }
  const cells = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6">
      <div className="grid grid-cols-7 bg-white rounded-xl border border-border overflow-hidden min-w-[640px]">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="text-xs font-medium text-muted-foreground px-3 py-2 border-b border-border bg-muted/40">{d}</div>
        ))}
        {cells.map((d) => {
          const list = byDay.get(d) ?? [];
          const inMonth = d.startsWith(month);
          const gross = list.reduce((s, b) => s + b.amount, 0);
          return (
            <button key={d} onClick={() => onPickDay(d)}
              className={`text-left min-h-28 p-2 border-b border-r border-border hover:bg-green-50/40 transition-colors ${inMonth ? "" : "bg-muted/30"}`}>
              <div className="flex items-center justify-between mb-1">
                <span className={`text-xs font-semibold w-6 h-6 rounded-full flex items-center justify-center ${d === ctx.today ? "bg-primary text-white" : inMonth ? "text-foreground" : "text-muted-foreground"}`}>
                  {Number(d.slice(8))}
                </span>
                {list.length > 0 && <span className="text-[10px] text-muted-foreground">{list.length} booking{list.length > 1 ? "s" : ""}</span>}
              </div>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((b) => (
                  <div key={b.id} className="text-[11px] truncate px-1.5 py-0.5 rounded" style={{ background: STATUS[b.status].bg, color: STATUS[b.status].color }}>
                    {fmtTime(b.startMin)} {b.customer}
                  </div>
                ))}
                {list.length > 3 && <div className="text-[11px] text-muted-foreground px-1.5">+{list.length - 3} more</div>}
              </div>
              {ctx.permissions.canViewReports && list.length > 0 && (
                <div className="text-[10px] text-muted-foreground mt-1">{money(gross, ctx.venue.currency, { compact: true })} booked</div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
