"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import {
  TrendingUp, TrendingDown, DollarSign, Calendar, Users, Clock, ArrowRight, Wallet, XCircle, Globe, Receipt,
} from "lucide-react";
import {
  api, ApiError, BRAND_GRADIENT, ErrorState, fmtDate, fmtTime, inputCls, money, sourceLabel, Spinner, StatusBadge, useBookingContext,
  type Booking,
} from "@/components/bookings/shared";
import { BookingForm } from "@/components/bookings/booking-form";
import { BookingDetails } from "@/components/bookings/booking-details";

type Agg = { key: string; name: string; gross: number | null; collected: number | null; bookings: number; occupancy?: number | null };
type Metrics = {
  gross: number | null; collected: number | null; paymentsReceived: number | null; refunds: number | null; bookings: number;
  cancellations: { count: number; value: number | null; rate: number };
  pending: { count: number; outstanding: number | null };
  occupancy: number | null; bookedHours: number; openHours: number;
  trend: { date: string; gross: number | null; collected: number | null; bookings: number; cancelled: number; online: number; offline: number }[];
  bySport: Agg[]; byCourt: Agg[]; bySource: Agg[];
  channel: Record<"online" | "offline" | "other", { bookings: number; gross: number | null }>;
};
type Dashboard = {
  venue: { id: string; name: string; timezone: string; currency: string };
  today: string;
  range: { key: string; from: string; to: string };
  canSeeRevenue: boolean;
  current: Metrics;
  previous: { gross: number | null; collected: number | null; bookings: number; occupancy: number | null };
  today_: { gross: number | null; collected: number | null; bookings: number; pending: { count: number; outstanding: number | null } };
  upcoming: (Booking & { amount: number | null })[];
  recent: (Booking & { amount: number | null })[];
  courtsInUseNow: number;
  activeCourts: number;
};

type RangeKey = "today" | "week" | "month" | "custom";

function change(cur: number | null, prev: number | null): { text: string; positive: boolean } | null {
  if (cur == null || prev == null) return null;
  if (prev === 0) return cur === 0 ? { text: "0%", positive: true } : null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  return { text: `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`, positive: pct >= 0 };
}

function StatCard({ icon: Icon, label, value, sub, delta, color }: {
  icon: React.ElementType; label: string; value: string; sub?: string; delta?: { text: string; positive: boolean } | null; color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: color + "15" }}>
          <Icon size={18} style={{ color }} />
        </div>
        {delta && (
          <div className={`flex items-center gap-1 text-xs font-medium ${delta.positive ? "text-green-600" : "text-red-500"}`} title="vs. previous period">
            {delta.positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {delta.text}
          </div>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-0.5">{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

function MiniCard({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string }) {
  return (
    <div className="bg-white rounded-xl border border-border p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: color + "15" }}>
        <Icon size={15} style={{ color }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold text-foreground">{value}</p>
        {sub && <p className="text-xs text-muted-foreground truncate">{sub}</p>}
      </div>
    </div>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);

export function DashboardScreen() {
  const router = useRouter();
  const { ctx } = useBookingContext();
  const [range, setRange] = useState<RangeKey>("week");
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [walkin, setWalkin] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (range === "custom" && (!custom.from || !custom.to)) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const p = new URLSearchParams({ range });
    if (range === "custom") { p.set("from", custom.from); p.set("to", custom.to); }
    api<Dashboard>(`/api/dashboard?${p}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: ApiError) => { if (!cancelled) setError(e.status === 404 ? "Set up your venue to see your dashboard." : e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [range, custom, refreshKey]);

  const cur = data?.venue.currency ?? "USD";
  const m = data?.current;
  const rev = data?.canSeeRevenue ?? false;
  const rangeLabel = data
    ? data.range.from === data.range.to ? fmtDate(data.range.from) : `${fmtDate(data.range.from, { month: "short", day: "numeric" })} – ${fmtDate(data.range.to, { month: "short", day: "numeric" })}`
    : "";
  const chartTrend = (m?.trend ?? []).map((t) => ({ ...t, label: fmtDate(t.date, m!.trend.length > 14 ? { month: "short", day: "numeric" } : { weekday: "short", day: "numeric" }) }));

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {data ? `${data.venue.name} · ${rangeLabel}` : "Overview of your venue performance"}
            {loading && data && <Spinner className="ml-2 align-middle text-muted-foreground" />}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={range} onChange={(e) => setRange(e.target.value as RangeKey)} className="pl-3 pr-8 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20" aria-label="Date range">
            <option value="today">Today</option>
            <option value="week">This week</option>
            <option value="month">This month</option>
            <option value="custom">Custom range</option>
          </select>
          {range === "custom" && (
            <>
              <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={`${inputCls} w-auto`} aria-label="From" />
              <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={`${inputCls} w-auto`} aria-label="To" />
            </>
          )}
          {ctx?.permissions.canEditBookings && (
            <button onClick={() => setWalkin(true)} className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all" style={{ background: BRAND_GRADIENT }}>
              + Walk-in Booking
            </button>
          )}
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !data || !m ? (
        range === "custom" && (!custom.from || !custom.to) ? (
          <p className="text-sm text-muted-foreground">Pick a start and end date.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-32 bg-white rounded-xl border border-border animate-pulse" />)}
          </div>
        )
      ) : (
        <>
          {/* Primary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={DollarSign} label="Collected Revenue" value={money(m.collected, cur)}
              sub={rev ? `Payments ${money(m.paymentsReceived, cur)} − refunds ${money(m.refunds, cur)}` : "Requires reports access"}
              delta={change(m.collected, data.previous.collected)} color="#16a34a" />
            <StatCard icon={TrendingUp} label="Today's Revenue" value={money(data.today_.collected, cur)}
              sub={rev ? `${money(data.today_.gross, cur)} booked today · ${data.today_.bookings} booking${data.today_.bookings === 1 ? "" : "s"}` : undefined} color="#2563eb" />
            <StatCard icon={Calendar} label="Total Bookings" value={String(m.bookings)} sub="Excludes cancellations" delta={change(m.bookings, data.previous.bookings)} color="#8b5cf6" />
            <StatCard icon={Users} label="Occupancy Rate" value={pct(m.occupancy)}
              sub={m.occupancy == null ? "Set operating hours to measure" : `${m.bookedHours}h booked of ${m.openHours}h open`}
              delta={m.occupancy != null && data.previous.occupancy != null ? { text: `${m.occupancy >= data.previous.occupancy ? "+" : ""}${Math.round((m.occupancy - data.previous.occupancy) * 100)} pts`, positive: m.occupancy >= data.previous.occupancy } : null}
              color="#f59e0b" />
          </div>

          {/* Secondary stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <MiniCard icon={Receipt} label="Gross booked" value={money(m.gross, cur)} sub="Value of bookings played in range" color="#0f766e" />
            <MiniCard icon={Wallet} label="Pending payments" value={money(m.pending.outstanding, cur)} sub={`${m.pending.count} booking${m.pending.count === 1 ? "" : "s"} with a balance`} color="#b45309" />
            <MiniCard icon={XCircle} label="Cancellations" value={String(m.cancellations.count)} sub={`${pct(m.cancellations.rate)} of bookings${rev ? ` · ${money(m.cancellations.value, cur)} lost` : ""}`} color="#dc2626" />
            <MiniCard icon={Globe} label="Online vs offline" value={`${m.channel.online.bookings} / ${m.channel.offline.bookings}`}
              sub={`Online: GameOn, Playo, District${m.channel.other.bookings ? ` · ${m.channel.other.bookings} other` : ""}`} color="#2563eb" />
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 bg-white rounded-xl border border-border p-5">
              <div className="mb-5">
                <h3 className="font-medium text-foreground">Revenue Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Gross booked vs. collected · {rangeLabel}</p>
              </div>
              {rev ? (
                <ResponsiveContainer width="100%" height={200}>
                  <AreaChart data={chartTrend} margin={{ top: 0, right: 0, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#16a34a" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={12} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} tickFormatter={(v) => money(v, cur, { compact: true })} />
                    <Tooltip formatter={(v: number, n: string) => [money(v, cur), n === "collected" ? "Collected" : "Gross booked"]} contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                    <Legend formatter={(v) => (v === "collected" ? "Collected" : "Gross booked")} wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="gross" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4 3" fill="none" />
                    <Area type="monotone" dataKey="collected" stroke="#16a34a" strokeWidth={2} fill="url(#revGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-sm text-muted-foreground py-16 text-center">Revenue is visible to staff with reports access.</p>
              )}
            </div>

            <div className="lg:col-span-2 bg-white rounded-xl border border-border p-5">
              <div className="mb-5">
                <h3 className="font-medium text-foreground">Booking Trend</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Online vs. offline bookings</p>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartTrend} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} minTickGap={8} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="offline" name="Offline" fill="#16a34a" stackId="a" />
                  <Bar dataKey="online" name="Online" fill="#2563eb" radius={[3, 3, 0, 0]} stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Breakdowns */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Breakdown title="Revenue by Sport" rows={m.bySport} currency={cur} rev={rev} />
            <Breakdown title="Revenue by Court" rows={m.byCourt} currency={cur} rev={rev} showOccupancy />
            <Breakdown title="Bookings by Source" rows={m.bySource.map((s) => ({ ...s, name: sourceLabel(s.name) }))} currency={cur} rev={rev} />
          </div>

          {/* Bottom row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="font-medium text-foreground">Recent Bookings</h3>
                <button onClick={() => router.push("/bookings")} className="text-sm text-primary hover:underline flex items-center gap-1">
                  View all <ArrowRight size={12} />
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px]">
                  <thead>
                    <tr className="bg-muted/40">
                      {["Booking ID", "Customer", "Court", "Time", "Amount", "Status"].map((h) => (
                        <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">No bookings yet</td></tr>
                    ) : data.recent.map((b) => (
                      <tr key={b.id} onClick={() => setSelected(b.id)} className="border-t border-border hover:bg-muted/20 cursor-pointer">
                        <td className="px-4 py-3 text-xs font-mono text-muted-foreground">#{b.ref}</td>
                        <td className="px-4 py-3 text-sm font-medium text-foreground">{b.customer}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{b.courtName}</td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{fmtDate(b.date, { month: "short", day: "numeric" })} · {fmtTime(b.startMin)}</td>
                        <td className="px-4 py-3 text-sm font-medium">{money(b.amount, cur)}</td>
                        <td className="px-4 py-3"><StatusBadge status={b.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h3 className="font-medium text-foreground">Upcoming</h3>
                <span className="text-xs text-muted-foreground">Next bookings</span>
              </div>
              <div className="p-4">
                {data.upcoming.length === 0 ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    <Clock size={24} className="mx-auto mb-2 opacity-40" />
                    No upcoming bookings
                  </div>
                ) : (
                  <ul className="space-y-2 mb-3">
                    {data.upcoming.map((b) => (
                      <li key={b.id}>
                        <button onClick={() => setSelected(b.id)} className="w-full flex items-center justify-between gap-2 text-left p-2 rounded-lg hover:bg-muted/40">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">{b.customer}</p>
                            <p className="text-xs text-muted-foreground truncate">{b.courtName} · {b.date === data.today ? "Today" : fmtDate(b.date, { weekday: "short", month: "short", day: "numeric" })}</p>
                          </div>
                          <span className="text-xs font-medium text-foreground flex-shrink-0">{fmtTime(b.startMin)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-muted-foreground">Court Occupancy Now</span>
                    <span className="text-xs font-medium text-foreground">{data.courtsInUseNow}/{data.activeCourts} courts</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-green-500" style={{ width: `${data.activeCourts ? (data.courtsInUseNow / data.activeCourts) * 100 : 0}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Collected = payments received minus refunds issued in the period. Gross booked = price of non-cancelled bookings played in the period.
            Times are in {data.venue.timezone.replace(/_/g, " ")}. Change figures compare with the previous period of the same length.
          </p>
        </>
      )}

      {walkin && ctx && <BookingForm ctx={ctx} mode="walkin" onClose={() => setWalkin(false)} onSaved={() => { setWalkin(false); refresh(); }} />}
      {selected && ctx && <BookingDetails ctx={ctx} bookingId={selected} onClose={() => setSelected(null)} onChanged={refresh} />}
    </div>
  );
}

function Breakdown({ title, rows, currency, rev, showOccupancy }: { title: string; rows: Agg[]; currency: string; rev: boolean; showOccupancy?: boolean }) {
  const max = Math.max(1, ...rows.map((r) => (rev ? r.gross ?? 0 : r.bookings)));
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <h3 className="font-medium text-foreground mb-4">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No bookings in this period</p>
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between text-sm mb-1 gap-2">
                <span className="text-foreground truncate min-w-0">{r.name}</span>
                <span className="font-medium text-foreground flex-shrink-0">{rev ? money(r.gross, currency) : r.bookings}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${((rev ? r.gross ?? 0 : r.bookings) / max) * 100}%`, background: "#16a34a" }} />
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {r.bookings} booking{r.bookings === 1 ? "" : "s"}{rev ? ` · ${money(r.collected, currency)} collected` : ""}{showOccupancy && r.occupancy != null ? ` · ${Math.round(r.occupancy * 100)}% occupied` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
