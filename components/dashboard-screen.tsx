"use client";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Calendar,
  Users,
  Clock,
  ArrowRight,
} from "lucide-react";

const statusConfig: Record<
  string,
  { label: string; bg: string; color: string }
> = {
  confirmed: { label: "Confirmed", bg: "#eff6ff", color: "#2563eb" },
  checked_in: { label: "Checked In", bg: "#f0fdf4", color: "#16a34a" },
  completed: { label: "Completed", bg: "#f8fafc", color: "#475569" },
  cancelled: { label: "Cancelled", bg: "#fff5f5", color: "#dc2626" },
};

function StatCard({
  icon: Icon,
  label,
  value,
  change,
  positive,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  change: string;
  positive: boolean;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-border p-5">
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center"
          style={{ background: color + "15" }}
        >
          <Icon size={18} style={{ color }} />
        </div>
        <div
          className={`flex items-center gap-1 text-xs font-medium ${positive ? "text-green-600" : "text-red-500"}`}
        >
          {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {change}
        </div>
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold text-foreground mt-0.5">{value}</p>
    </div>
  );
}

export function DashboardScreen() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Overview of your venue performance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select className="appearance-none pl-3 pr-5 py-2 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20">
              <option>Last 7 days</option>
              <option>Last 30 days</option>
              <option>Last 90 days</option>
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-2.5 flex items-center">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path
                  d="M2.5 4.5L6 8l3.5-3.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <button
            className="flex items-center gap-1.5 text-sm font-medium text-white px-4 py-2 rounded-lg hover:opacity-90 transition-all"
            style={{ background: "linear-gradient(135deg, #16a34a, #15803d)" }}
          >
            + Walk-in Booking
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={DollarSign}
          label="Total Revenue"
          value="$0"
          change="+0%"
          positive
          color="#16a34a"
        />
        <StatCard
          icon={TrendingUp}
          label="Today's Revenue"
          value="$0"
          change="+0%"
          positive
          color="#2563eb"
        />
        <StatCard
          icon={Calendar}
          label="Total Bookings"
          value="0"
          change="+0%"
          positive
          color="#8b5cf6"
        />
        <StatCard
          icon={Users}
          label="Occupancy Rate"
          value="0%"
          change="0%"
          positive={false}
          color="#f59e0b"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-5 gap-4">
        {/* Revenue chart */}
        <div className="col-span-3 bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-medium text-foreground">Revenue Trend</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Last 7 days
              </p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart
              data={[]}
              margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
            >
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#16a34a" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, "Revenue"]}
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Area
                type="monotone"
                dataKey="revenue"
                stroke="#16a34a"
                strokeWidth={2}
                fill="url(#revGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Booking trend */}
        <div className="col-span-2 bg-white rounded-xl border border-border p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-medium text-foreground">Booking Trend</h3>
              <p className="text-xs text-muted-foreground mt-0.5">This week</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={[]}
              margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis
                dataKey="day"
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                tick={{ fontSize: 11, fill: "#94a3b8" }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
              />
              <Bar
                dataKey="confirmed"
                fill="#16a34a"
                radius={[3, 3, 0, 0]}
                stackId="a"
              />
              <Bar
                dataKey="walkin"
                fill="#2563eb"
                radius={[3, 3, 0, 0]}
                stackId="a"
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-3 gap-4">
        {/* Recent bookings */}
        <div className="col-span-2 bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-medium text-foreground">Recent Bookings</h3>
            <button className="text-sm text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight size={12} />
            </button>
          </div>
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40">
                {[
                  "Booking ID",
                  "Customer",
                  "Court",
                  "Time",
                  "Amount",
                  "Status",
                ].map((h) => (
                  <th
                    key={h}
                    className="text-left text-xs font-medium text-muted-foreground px-4 py-3"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-12 text-center text-sm text-muted-foreground"
                >
                  No bookings yet
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Upcoming */}
        <div className="bg-white rounded-xl border border-border overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="font-medium text-foreground">Upcoming</h3>
            <span className="text-xs text-muted-foreground">Today</span>
          </div>
          <div className="p-4">
            <div className="text-center py-8 text-sm text-muted-foreground">
              <Clock size={24} className="mx-auto mb-2 opacity-40" />
              No upcoming bookings
            </div>

            {/* Occupancy */}
            <div className="pt-3 border-t border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Court Occupancy Now
                </span>
                <span className="text-xs font-medium text-foreground">
                  0/0 courts
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
