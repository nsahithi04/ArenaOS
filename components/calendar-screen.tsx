'use client'
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Wrench, User, Clock } from "lucide-react";

const courts = ["Court 1", "Court 2", "Court 3", "Court 4"];

const HOUR_START = 6;
const HOUR_END = 22;
const SLOT_HEIGHT = 56;

type BookingStatus = "confirmed" | "walkin" | "maintenance" | "pending" | "completed";

interface Booking {
  id: string;
  court: number;
  startHour: number;
  duration: number;
  customer: string;
  sport: string;
  status: BookingStatus;
  amount: string;
}

const statusConfig: Record<BookingStatus, { bg: string; border: string; text: string; label: string }> = {
  confirmed: { bg: "#eff6ff", border: "#93c5fd", text: "#1d4ed8", label: "Confirmed" },
  walkin: { bg: "#f0fdf4", border: "#86efac", text: "#15803d", label: "Walk-in" },
  maintenance: { bg: "#f8fafc", border: "#cbd5e1", text: "#475569", label: "Maintenance" },
  pending: { bg: "#fffbeb", border: "#fcd34d", text: "#92400e", label: "Pending" },
  completed: { bg: "#f5f3ff", border: "#c4b5fd", text: "#5b21b6", label: "Completed" },
};

const hours = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);

function formatHour(h: number) {
  if (h === 12) return "12 PM";
  if (h < 12) return `${h} AM`;
  return `${h - 12} PM`;
}

type AddBookingModal = { open: boolean; court: number; hour: number };

export function CalendarScreen() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [modal, setModal] = useState<AddBookingModal>({ open: false, court: 0, hour: 0 });
  const [currentDate, setCurrentDate] = useState(new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" }));
  const [filterStatus, setFilterStatus] = useState<BookingStatus | "all">("all");

  const filtered = filterStatus === "all" ? bookings : bookings.filter((b) => b.status === filterStatus);

  const handleSlotClick = (courtIdx: number, hour: number) => {
    const occupied = bookings.some((b) => b.court === courtIdx && hour >= b.startHour && hour < b.startHour + b.duration);
    if (!occupied) setModal({ open: true, court: courtIdx, hour });
  };

  const addWalkin = () => {
    const newBooking: Booking = {
      id: `B${bookings.length + 1}`,
      court: modal.court,
      startHour: modal.hour,
      duration: 1,
      customer: "Walk-in Customer",
      sport: "🏸",
      status: "walkin",
      amount: "$0",
    };
    setBookings([...bookings, newBooking]);
    setModal({ open: false, court: 0, hour: 0 });
  };

  const addMaintenance = () => {
    const newBooking: Booking = {
      id: `B${bookings.length + 1}`,
      court: modal.court,
      startHour: modal.hour,
      duration: 2,
      customer: "Maintenance",
      sport: "🔧",
      status: "maintenance",
      amount: "—",
    };
    setBookings([...bookings, newBooking]);
    setModal({ open: false, court: 0, hour: 0 });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-border flex-shrink-0">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold text-foreground">Booking Calendar</h1>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <button className="px-3 py-1.5 rounded-md text-sm font-medium bg-white shadow-sm text-foreground">Day</button>
            <button className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground">Week</button>
            <button className="px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:text-foreground">Month</button>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition-colors">
              <ChevronLeft size={14} />
            </button>
            <span className="text-sm font-medium text-foreground min-w-36 text-center">{currentDate}</span>
            <button className="w-8 h-8 rounded-lg border border-border hover:bg-muted flex items-center justify-center transition-colors">
              <ChevronRight size={14} />
            </button>
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as BookingStatus | "all")}
            className="px-3 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">All Bookings</option>
            <option value="confirmed">Confirmed</option>
            <option value="walkin">Walk-in</option>
            <option value="pending">Pending</option>
            <option value="maintenance">Maintenance</option>
          </select>

          <button className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>
            <Plus size={14} /> Add Booking
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-6 py-2 bg-white border-b border-border flex-shrink-0">
        {Object.entries(statusConfig).map(([key, s]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm border" style={{ background: s.bg, borderColor: s.border }} />
            <span className="text-xs text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="flex-1 overflow-auto">
        <div className="flex min-w-max">
          {/* Time column */}
          <div className="w-16 flex-shrink-0 bg-white border-r border-border">
            <div className="h-12 border-b border-border" />
            {hours.map((h) => (
              <div key={h} className="border-b border-border flex items-start justify-end pr-3 pt-1" style={{ height: SLOT_HEIGHT }}>
                <span className="text-xs text-muted-foreground">{formatHour(h)}</span>
              </div>
            ))}
          </div>

          {/* Courts columns */}
          {courts.map((court, courtIdx) => (
            <div key={court} className="flex-1 min-w-48 border-r border-border last:border-r-0">
              {/* Court header */}
              <div className="h-12 border-b border-border bg-white flex items-center justify-center px-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-sm font-medium text-foreground">{court}</span>
                </div>
              </div>

              {/* Hour slots */}
              <div className="relative bg-white">
                {hours.map((h) => (
                  <div
                    key={h}
                    onClick={() => handleSlotClick(courtIdx, h)}
                    className="border-b border-border cursor-pointer hover:bg-green-50/30 transition-colors group"
                    style={{ height: SLOT_HEIGHT }}
                  >
                    {(h >= 18 && h < 22) && (
                      <div className="absolute left-0 w-1 h-full bg-orange-200 opacity-50" />
                    )}
                    <div className="opacity-0 group-hover:opacity-100 absolute inset-1 rounded border-2 border-dashed border-green-300 flex items-center justify-center pointer-events-none transition-opacity">
                      <Plus size={14} className="text-green-500" />
                    </div>
                  </div>
                ))}

                {/* Booking blocks */}
                {filtered
                  .filter((b) => b.court === courtIdx)
                  .map((b) => {
                    const s = statusConfig[b.status];
                    const top = (b.startHour - HOUR_START) * SLOT_HEIGHT;
                    const height = b.duration * SLOT_HEIGHT - 4;
                    return (
                      <div
                        key={b.id}
                        onClick={(e) => { e.stopPropagation(); setSelected(b); }}
                        className="absolute left-1 right-1 rounded-lg border overflow-hidden cursor-pointer hover:shadow-md transition-all z-10"
                        style={{ top: top + 2, height, background: s.bg, borderColor: s.border }}
                      >
                        <div className="w-1 absolute left-0 top-0 bottom-0 rounded-l-lg" style={{ background: s.border }} />
                        <div className="pl-2.5 pr-2 py-1.5">
                          <div className="flex items-center gap-1 mb-0.5">
                            <span className="text-xs">{b.sport}</span>
                            <span className="text-xs font-semibold truncate" style={{ color: s.text }}>{b.customer}</span>
                          </div>
                          {height > 50 && (
                            <div className="flex items-center gap-1">
                              <Clock size={9} style={{ color: s.text, opacity: 0.7 }} />
                              <span className="text-xs opacity-70" style={{ color: s.text }}>
                                {formatHour(b.startHour)} – {formatHour(b.startHour + b.duration)}
                              </span>
                            </div>
                          )}
                          {height > 70 && (
                            <span className="text-xs font-medium mt-0.5 block" style={{ color: s.text }}>{b.amount}</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Booking detail panel */}
      {selected && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setSelected(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-80 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-foreground">Booking Details</h3>
              <button onClick={() => setSelected(null)} className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground">✕</button>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-xl">{selected.sport}</div>
                <div>
                  <p className="font-medium text-foreground">{selected.customer}</p>
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                    style={{ background: statusConfig[selected.status].bg, color: statusConfig[selected.status].text }}>
                    {statusConfig[selected.status].label}
                  </span>
                </div>
              </div>
              {[
                ["Court", courts[selected.court]],
                ["Time", `${formatHour(selected.startHour)} – ${formatHour(selected.startHour + selected.duration)}`],
                ["Duration", `${selected.duration}h`],
                ["Amount", selected.amount],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between py-2 border-b border-border last:border-0">
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-medium text-foreground">{value}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button className="flex-1 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">Reschedule</button>
              <button className="flex-1 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
                style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}>Check In</button>
            </div>
          </div>
        </div>
      )}

      {/* Add booking modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setModal({ open: false, court: 0, hour: 0 })}>
          <div className="bg-white rounded-2xl shadow-xl w-72 p-6" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-foreground mb-1">Add to slot</h3>
            <p className="text-sm text-muted-foreground mb-4">{courts[modal.court]} · {formatHour(modal.hour)}</p>
            <div className="space-y-2">
              <button onClick={addWalkin} className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-green-50 hover:border-green-200 transition-all text-left">
                <User size={16} className="text-green-600" />
                <div>
                  <p className="text-sm font-medium">Walk-in Booking</p>
                  <p className="text-xs text-muted-foreground">Add a same-day booking</p>
                </div>
              </button>
              <button onClick={addMaintenance} className="w-full flex items-center gap-3 p-3 rounded-lg border border-border hover:bg-slate-50 hover:border-slate-300 transition-all text-left">
                <Wrench size={16} className="text-slate-500" />
                <div>
                  <p className="text-sm font-medium">Block for Maintenance</p>
                  <p className="text-xs text-muted-foreground">Mark as unavailable</p>
                </div>
              </button>
            </div>
            <button onClick={() => setModal({ open: false, court: 0, hour: 0 })} className="w-full mt-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
