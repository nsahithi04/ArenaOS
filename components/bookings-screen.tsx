'use client'
import { useState } from "react";
import { Search, Calendar, XCircle, RefreshCw, UserCheck, Filter, Download } from "lucide-react";

type Status = "confirmed" | "checked_in" | "completed" | "cancelled" | "pending";

interface Booking {
  id: string;
  customer: string;
  phone: string;
  court: string;
  sport: string;
  date: string;
  time: string;
  amount: string;
  payment: "paid" | "pending" | "refunded";
  status: Status;
}

const allBookings: Booking[] = [];

const statusConfig: Record<Status, { label: string; bg: string; color: string }> = {
  confirmed: { label: "Confirmed", bg: "#eff6ff", color: "#2563eb" },
  checked_in: { label: "Checked In", bg: "#f0fdf4", color: "#16a34a" },
  completed: { label: "Completed", bg: "#f8fafc", color: "#475569" },
  cancelled: { label: "Cancelled", bg: "#fff5f5", color: "#dc2626" },
  pending: { label: "Pending", bg: "#fffbeb", color: "#b45309" },
};

const paymentConfig: Record<string, { label: string; bg: string; color: string }> = {
  paid: { label: "Paid", bg: "#f0fdf4", color: "#15803d" },
  pending: { label: "Pending", bg: "#fffbeb", color: "#b45309" },
  refunded: { label: "Refunded", bg: "#faf5ff", color: "#7c3aed" },
};

type FilterTab = "all" | "today" | "week" | "completed" | "cancelled";

export function BookingsScreen() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");

  const tabs: { id: FilterTab; label: string; count: number }[] = [
    { id: "all", label: "All Bookings", count: 0 },
    { id: "today", label: "Today", count: 0 },
    { id: "week", label: "This Week", count: 0 },
    { id: "completed", label: "Completed", count: 0 },
    { id: "cancelled", label: "Cancelled", count: 0 },
  ];

  const filtered = allBookings.filter((b) => {
    const matchSearch = !search || b.customer.toLowerCase().includes(search.toLowerCase()) || b.id.toLowerCase().includes(search.toLowerCase());
    return matchSearch;
  });

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Bookings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Manage and track all court bookings</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
            <Download size={14} /> Export
          </button>
          <button className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
            + New Booking
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-border p-2 gap-2">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === tab.id ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
            >
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${activeTab === tab.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search bookings..."
              className="pl-8 pr-4 py-2 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/20 w-48 placeholder:text-muted-foreground"
            />
          </div>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <Filter size={14} /> Filter
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-muted/40 border-b border-border">
              {["Booking ID", "Customer", "Court", "Sport", "Date & Time", "Amount", "Payment", "Status", "Actions"].map((h) => (
                <th key={h} className="text-left text-xs font-medium text-muted-foreground px-4 py-3.5">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => {
              const s = statusConfig[b.status];
              const p = paymentConfig[b.payment];
              return (
                <tr key={b.id} className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors ${i % 2 === 0 ? "" : "bg-muted/10"}`}>
                  <td className="px-4 py-3.5">
                    <span className="text-xs font-mono text-muted-foreground">{b.id}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">{b.customer}</p>
                      <p className="text-xs text-muted-foreground">{b.phone}</p>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-sm text-muted-foreground">{b.court}</td>
                  <td className="px-4 py-3.5 text-sm text-muted-foreground">{b.sport}</td>
                  <td className="px-4 py-3.5">
                    <p className="text-sm text-foreground">{b.date}</p>
                    <p className="text-xs text-muted-foreground">{b.time}</p>
                  </td>
                  <td className="px-4 py-3.5 text-sm font-medium text-foreground">{b.amount}</td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: p.bg, color: p.color }}>{p.label}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-1">
                      {b.status === "confirmed" && (
                        <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-green-600 hover:bg-green-50 transition-colors">
                          <UserCheck size={12} /> Check In
                        </button>
                      )}
                      {(b.status === "confirmed" || b.status === "pending") && (
                        <>
                          <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-blue-600 hover:bg-blue-50 transition-colors">
                            <RefreshCw size={12} /> Reschedule
                          </button>
                          <button className="flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-500 hover:bg-red-50 transition-colors">
                            <XCircle size={12} /> Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Calendar size={32} className="mx-auto text-muted-foreground mb-3" />
            <p className="text-muted-foreground text-sm">No bookings found</p>
          </div>
        )}
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Showing {filtered.length} of {allBookings.length} bookings</span>
        <div className="flex items-center gap-1">
          {[1].map((p) => (
            <button key={p} className="w-8 h-8 rounded-lg text-sm font-medium transition-colors bg-primary text-white">{p}</button>
          ))}
        </div>
      </div>
    </div>
  );
}
