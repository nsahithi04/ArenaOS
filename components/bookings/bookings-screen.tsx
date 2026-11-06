'use client'
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Calendar, XCircle, RefreshCw, UserCheck, Filter, Download, X } from "lucide-react";
import {
  addDays, api, ApiError, BRAND_GRADIENT, ConfirmDialog, ErrorState, fmtDate, fmtTime, inputCls, money, PaymentBadge, SOURCES,
  sourceLabel, Spinner, StatusBadge, STATUS, useBookingContext, weekStart,
  type Booking, type BookingStatus,
} from "@/components/bookings/shared";
import { BookingForm, type BookingFormMode } from "@/components/bookings/booking-form";
import { BookingDetails } from "@/components/bookings/booking-details";

type FilterTab = "all" | "today" | "week" | "completed" | "cancelled";
type ListResponse = { items: Booking[]; total: number; page: number; pageSize: number; currency: string };
type Filters = { courtId: string; sportId: string; source: string; status: string; payment: string; from: string; to: string };
const EMPTY_FILTERS: Filters = { courtId: "", sportId: "", source: "", status: "", payment: "", from: "", to: "" };
const PAGE_SIZE = 25;

export function BookingsScreen() {
  const { ctx, error: ctxError, loading: ctxLoading, reload: reloadCtx } = useBookingContext();
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<ListResponse | null>(null);
  const [counts, setCounts] = useState<Record<FilterTab, number | null>>({ all: null, today: null, week: null, completed: null, cancelled: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [form, setForm] = useState<{ mode: BookingFormMode; booking?: Booking } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setPage(1), [activeTab, debouncedSearch, filters]);

  const tabParams = useCallback((tab: FilterTab): Record<string, string> => {
    if (!ctx) return {};
    const today = ctx.today;
    switch (tab) {
      case "today": return { from: today, to: today, order: "asc" };
      case "week": return { from: weekStart(today), to: addDays(weekStart(today), 6), order: "asc" };
      case "completed": return { status: "COMPLETED", order: "desc" };
      case "cancelled": return { status: "CANCELLED", order: "desc" };
      default: return { order: "desc" };
    }
  }, [ctx]);

  const buildQuery = useCallback((tab: FilterTab, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (ctx) p.set("venueId", ctx.venue.id);
    const t = tabParams(tab);
    for (const [k, v] of Object.entries(filters)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(t)) if (v && !(k in filters && filters[k as keyof Filters])) p.set(k, v);
    if (debouncedSearch) p.set("q", debouncedSearch);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return p.toString();
  }, [ctx, filters, debouncedSearch, tabParams]);

  // Current page
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<ListResponse>(`/api/bookings?${buildQuery(activeTab, { page: String(page), pageSize: String(PAGE_SIZE) })}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: ApiError) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ctx, activeTab, page, buildQuery, refreshKey]);

  // Tab counts (same search/filters, each tab's own date/status scope)
  useEffect(() => {
    if (!ctx) return;
    let cancelled = false;
    const tabs: FilterTab[] = ["all", "today", "week", "completed", "cancelled"];
    Promise.all(tabs.map((t) => api<ListResponse>(`/api/bookings?${buildQuery(t, { pageSize: "1" })}`).then((d) => d.total).catch(() => null)))
      .then((totals) => { if (!cancelled) setCounts(Object.fromEntries(tabs.map((t, i) => [t, totals[i]])) as Record<FilterTab, number | null>); });
    return () => { cancelled = true; };
  }, [ctx, buildQuery, refreshKey]);

  const refresh = () => setRefreshKey((k) => k + 1);
  const canEdit = ctx?.permissions.canEditBookings ?? false;
  const currency = ctx?.venue.currency ?? "USD";
  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  async function quickStatus(b: Booking, status: BookingStatus, extra: Record<string, unknown> = {}, msg = "Booking updated") {
    setRowBusy(b.id);
    try {
      await api(`/api/bookings/${b.id}`, { method: "PATCH", json: { status, ...extra } });
      toast.success(msg);
      refresh();
    } catch (e) {
      toast.error((e as ApiError).message);
    } finally {
      setRowBusy(null);
      setCancelTarget(null);
      setCancelReason("");
    }
  }

  function exportCsv() {
    const a = document.createElement("a");
    a.href = `/api/bookings?${buildQuery(activeTab, { format: "csv" })}`;
    a.download = "bookings.csv";
    a.click();
  }

  const tabs: { id: FilterTab; label: string }[] = [
    { id: "all", label: "All Bookings" },
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "completed", label: "Completed" },
    { id: "cancelled", label: "Cancelled" },
  ];

  const pageNumbers = useMemo(() => {
    const out: number[] = [];
    const startP = Math.max(1, Math.min(page - 2, totalPages - 4));
    for (let p = startP; p <= Math.min(totalPages, startP + 4); p++) out.push(p);
    return out;
  }, [page, totalPages]);

  if (ctxLoading) return <div className="flex items-center justify-center h-64 text-muted-foreground"><Spinner /></div>;
  if (ctxError || !ctx) return <div className="p-6"><ErrorState message={ctxError ?? "Unable to load bookings"} onRetry={reloadCtx} /></div>;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage and track all court bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
            <Download size={14} /> Export
          </button>
          {canEdit && (
            <>
              <button onClick={() => setForm({ mode: "walkin" })} className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
                + Walk-in
              </button>
              <button onClick={() => setForm({ mode: "create" })} className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all" style={{ background: BRAND_GRADIENT }}>
                + New Booking
              </button>
            </>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-border p-2 space-y-2">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2">
          <div className="flex gap-1 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  activeTab === tab.id ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              >
                {tab.label}
                <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                  {counts[tab.id] ?? "–"}
                </span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 lg:flex-none">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={canEdit ? "Name, phone, booking ID…" : "Name or booking ID…"}
                className="pl-8 pr-4 py-2 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/20 w-full lg:w-56 placeholder:text-muted-foreground"
              />
            </div>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm transition-colors ${showFilters || activeFilterCount ? "border-primary/40 text-primary bg-green-50" : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <Filter size={14} /> Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
          </div>
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2 p-2 border-t border-border">
            <select value={filters.courtId} onChange={(e) => setFilters({ ...filters, courtId: e.target.value })} className={inputCls} aria-label="Court">
              <option value="">All courts</option>
              {ctx.courts.map((c) => <option key={c.id} value={c.id}>{c.name}{!c.isActive ? " (removed)" : ""}</option>)}
            </select>
            <select value={filters.sportId} onChange={(e) => setFilters({ ...filters, sportId: e.target.value })} className={inputCls} aria-label="Sport">
              <option value="">All sports</option>
              {ctx.sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} className={inputCls} aria-label="Source">
              <option value="">All sources</option>
              <option value="GAMEON,PLAYO,DISTRICT">Online (all)</option>
              <option value="WALK_IN,PHONE,WHATSAPP">Offline (all)</option>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={inputCls} aria-label="Status">
              <option value="">All statuses</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filters.payment} onChange={(e) => setFilters({ ...filters, payment: e.target.value })} className={inputCls} aria-label="Payment">
              <option value="">All payments</option>
              <option value="PAID">Paid</option>
              <option value="PENDING">Unpaid / part paid</option>
              <option value="REFUNDED">Refunded</option>
            </select>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} className={inputCls} aria-label="From date" />
            <div className="flex gap-2">
              <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} className={inputCls} aria-label="To date" />
              {activeFilterCount > 0 && (
                <button onClick={() => setFilters(EMPTY_FILTERS)} title="Clear filters" className="px-2 rounded-lg border border-border text-muted-foreground hover:bg-muted"><X size={14} /></button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden relative">
        {loading && data && <div className="absolute inset-x-0 top-0 h-0.5 bg-primary/60 animate-pulse" />}
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : !data ? (
          <div className="py-16 flex justify-center text-muted-foreground"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] whitespace-nowrap">
              <thead>
                <tr className="bg-muted/40 border-b border-border">
                  {["Booking ID", "Customer", "Court", "Sport", "Date & Time", "Source", "Amount", "Payment", "Status", "Actions"].map((h) => (
                    <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((b, i) => (
                  <tr
                    key={b.id}
                    onClick={() => setDetailsId(b.id)}
                    className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer ${i % 2 === 0 ? "" : "bg-muted/10"}`}
                  >
                    <td className="px-4 py-3.5"><span className="text-xs font-mono text-muted-foreground">#{b.ref}</span></td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-foreground">{b.customer}</p>
                      {b.phone && <p className="text-xs text-muted-foreground">{b.phone}</p>}
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{b.courtName}</td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{b.sportName ?? "—"}</td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm text-foreground">{fmtDate(b.date)}</p>
                      <p className="text-xs text-muted-foreground">{fmtTime(b.startMin)} – {fmtTime(b.endMin)}</p>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-muted-foreground">{sourceLabel(b.source)}</td>
                    <td className="px-4 py-3.5 text-sm font-medium text-foreground">{money(b.amount, currency)}</td>
                    <td className="px-4 py-3.5"><PaymentBadge payment={b.payment} paid={b.paid} balance={b.balance} /></td>
                    <td className="px-4 py-3.5"><StatusBadge status={b.status} /></td>
                    <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          {rowBusy === b.id && <Spinner className="text-muted-foreground" />}
                          {(b.status === "CONFIRMED" || b.status === "PENDING") && (
                            <button onClick={() => quickStatus(b, "CHECKED_IN", {}, `${b.customer} checked in`)} disabled={rowBusy === b.id} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-600 hover:bg-green-50 transition-colors">
                              <UserCheck size={12} /> Check In
                            </button>
                          )}
                          {(b.status === "CONFIRMED" || b.status === "PENDING") && (
                            <>
                              <button onClick={() => setForm({ mode: "reschedule", booking: b })} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors">
                                <RefreshCw size={12} /> Reschedule
                              </button>
                              <button onClick={() => setCancelTarget(b)} className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                                <XCircle size={12} /> Cancel
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {data.items.length === 0 && (
              <div className="text-center py-16">
                <Calendar size={32} className="mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground text-sm">
                  {debouncedSearch || activeFilterCount || activeTab !== "all" ? "No bookings match these filters" : "No bookings yet"}
                </p>
                {canEdit && activeTab === "all" && !debouncedSearch && !activeFilterCount && (
                  <button onClick={() => setForm({ mode: "create" })} className="mt-3 text-sm text-primary hover:underline">Create the first booking</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, data.total)} of {data.total} bookings
          </span>
          <div className="flex items-center gap-1">
            <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-2 h-8 rounded-lg hover:bg-muted disabled:opacity-40">Prev</button>
            {pageNumbers.map((p) => (
              <button key={p} onClick={() => setPage(p)} className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? "bg-primary text-white" : "hover:bg-muted"}`}>{p}</button>
            ))}
            <button disabled={page >= totalPages} onClick={() => setPage(page + 1)} className="px-2 h-8 rounded-lg hover:bg-muted disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {detailsId && <BookingDetails ctx={ctx} bookingId={detailsId} onClose={() => setDetailsId(null)} onChanged={refresh} />}
      {form && (
        <BookingForm
          ctx={ctx}
          mode={form.mode}
          booking={form.booking}
          onClose={() => setForm(null)}
          onSaved={() => { setForm(null); refresh(); }}
        />
      )}
      {cancelTarget && (
        <ConfirmDialog
          title="Cancel this booking?"
          message={<>{cancelTarget.customer} · {cancelTarget.courtName} · {fmtDate(cancelTarget.date)} {fmtTime(cancelTarget.startMin)}. The slot becomes available immediately.{cancelTarget.paid - cancelTarget.refunded > 0 && <span className="block mt-2 text-amber-700">{money(cancelTarget.paid - cancelTarget.refunded, currency)} has been paid. Open the booking to record a refund.</span>}</>}
          confirmLabel="Cancel booking"
          danger
          busy={rowBusy === cancelTarget.id}
          onCancel={() => { setCancelTarget(null); setCancelReason(""); }}
          onConfirm={() => quickStatus(cancelTarget, "CANCELLED", { cancelReason: cancelReason || null }, "Booking cancelled")}
        >
          <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} maxLength={500} placeholder="Reason (optional)" className={`${inputCls} mt-3`} />
        </ConfirmDialog>
      )}
    </div>
  );
}
