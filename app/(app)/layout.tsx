"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut, SessionProvider, useSession } from "next-auth/react";
import { Toaster } from "sonner";
import { NotificationBell } from "@/components/staff/notification-bell";
import { Logo } from "@/components/brand/logo";
import { usePermissions } from "@/hooks/use-permissions";
import {
  LayoutDashboard,
  Calendar,
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Search,
  User,
  Building2,
  LogOut,
  BadgeCheck,
  GraduationCap,
  Trophy,
  Wallet,
  UsersRound,
  CalendarClock,
  ChevronDown,
} from "lucide-react";

type NavItem = { href: string; label: string; icon: typeof LayoutDashboard };

// Sidebar sections. Each one can be hidden/shown by clicking its heading.
const navSections: { id: string; label: string; items: NavItem[] }[] = [
  { id: "overview", label: "Overview", items: [{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    id: "bookings",
    label: "Bookings",
    items: [
      { href: "/calendar", label: "Booking Calendar", icon: Calendar },
      { href: "/bookings", label: "All Bookings", icon: BookOpen },
    ],
  },
  {
    id: "club",
    label: "Club",
    items: [
      { href: "/members", label: "Members", icon: BadgeCheck },
      { href: "/classes", label: "Classes", icon: GraduationCap },
      { href: "/tournaments", label: "Tournaments", icon: Trophy },
    ],
  },
  { id: "finance", label: "Finance", items: [{ href: "/payments", label: "Payments", icon: Wallet }] },
  {
    id: "team",
    label: "Team",
    items: [
      { href: "/staff", label: "Staff", icon: UsersRound },
      { href: "/my-shifts", label: "My Shifts", icon: CalendarClock },
    ],
  },
];

const HIDDEN_KEY = "gameon.sidebar.hiddenSections";
const COLLAPSED_KEY = "gameon.sidebar.collapsed";

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preference just isn't remembered */
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
      <Toaster position="bottom-right" richColors closeButton />
    </SessionProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [venueName, setVenueName] = useState("Your Venue");
  const [topSearch, setTopSearch] = useState("");
  const pathname = usePathname();
  const router = useRouter();

  // Remembered per browser. Phone-sized screens always start collapsed so content has room.
  useEffect(() => {
    setHidden(readStored<string[]>(HIDDEN_KEY, []));
    setCollapsedState(window.innerWidth < 768 ? true : readStored<boolean>(COLLAPSED_KEY, false));
  }, []);
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    writeStored(COLLAPSED_KEY, v);
  };
  const toggleSection = (id: string) =>
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id];
      writeStored(HIDDEN_KEY, next);
      return next;
    });

  useEffect(() => {
    fetch("/api/venues")
      .then((r) => r.json())
      .then((venues) => {
        if (venues[0]?.name) setVenueName(venues[0].name);
      })
      .catch(() => {});
  }, []);

  const { data: session, status } = useSession();
  const { canView, isOwner } = usePermissions();
  const sessionLoading = status === "loading";
  const venueActive = pathname.startsWith("/venue");
  const settingsActive = pathname.startsWith("/settings");

  // Which pages this person can open.
  const allowed = (item: NavItem) => {
    // Dashboard (revenue/stats) is for owners and managers; calendar and bookings for anyone with bookings access.
    if (item.href === "/dashboard") return canView("reports");
    if (item.href === "/payments") return canView("billing");
    if (item.href === "/staff") return canView("team");
    // Owners aren't on the staff list, so they have no personal shifts
    if (item.href === "/my-shifts") return !isOwner && !!session?.user?.venueId;
    if (["/calendar", "/bookings", "/members", "/classes", "/tournaments"].includes(item.href)) return canView("bookings");
    return true;
  };

  return (
    <div className="flex h-screen bg-muted overflow-hidden">
      {/* Sidebar */}
      <aside
        className="flex flex-col flex-shrink-0 transition-all duration-300 relative"
        style={{
          width: collapsed ? 64 : 240,
          background: "#0f172a",
          borderRight: "1px solid #1e293b",
        }}
      >
        {/* Logo */}
        <div className="flex items-center justify-between px-4 py-5 border-b border-white/10">
          {!collapsed && <Logo dark size="md" />}
          {collapsed && (
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center mx-auto"
              style={{
                background: "linear-gradient(135deg, #16a34a 0%, #2563eb 100%)",
              }}
            >
              <svg width={16} height={16} viewBox="0 0 20 20" fill="none">
                <path
                  d="M10 2L3 7v6l7 5 7-5V7L10 2z"
                  fill="white"
                  fillOpacity="0.9"
                />
                <circle cx="10" cy="10" r="2.5" fill="white" />
              </svg>
            </div>
          )}
        </div>

        {/* Main nav */}
        <nav className="flex-1 py-3 px-2 overflow-y-auto">
          {sessionLoading
            ? Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="h-9 rounded-lg bg-white/5 animate-pulse mx-1 mb-1" />
              ))
            : navSections
                .map((section) => ({ ...section, items: section.items.filter(allowed) }))
                .filter((section) => section.items.length > 0)
                .map((section, i) => {
                  const isHidden = hidden.includes(section.id);
                  // A hidden section still shows the page you're on, so you never lose your place.
                  const shown = collapsed || !isHidden ? section.items : section.items.filter((it) => pathname.startsWith(it.href));
                  return (
                    <div key={section.id} className={i > 0 ? (collapsed ? "mt-2 pt-2 border-t border-white/10" : "mt-3") : ""}>
                      {!collapsed && (
                        <button
                          onClick={() => toggleSection(section.id)}
                          aria-expanded={!isHidden}
                          title={isHidden ? `Show ${section.label}` : `Hide ${section.label}`}
                          className="group w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[11px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          <span>{section.label}</span>
                          <span className="flex items-center gap-1.5">
                            {isHidden && section.items.length > shown.length && <span className="normal-case tracking-normal font-normal text-slate-600 group-hover:text-slate-400">{section.items.length - shown.length} hidden</span>}
                            <ChevronDown size={13} className={`transition-transform ${isHidden ? "-rotate-90" : ""}`} />
                          </span>
                        </button>
                      )}
                      <div className="space-y-1">
                        {shown.map((item) => {
                          const Icon = item.icon;
                          const active = pathname.startsWith(item.href);
                          return (
                            <button
                              key={item.href}
                              onClick={() => router.push(item.href)}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                                active ? "text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
                              }`}
                              style={active ? { background: "rgba(22,163,74,0.2)", color: "#4ade80" } : {}}
                              title={collapsed ? item.label : undefined}
                            >
                              <Icon size={18} className="flex-shrink-0" />
                              {!collapsed && <span>{item.label}</span>}
                              {!collapsed && active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
        </nav>


        {/* Bottom section */}
        <div className="px-2 pb-4 space-y-1 border-t border-white/10 pt-3">
          {sessionLoading && (
            <>
              <div className="h-9 rounded-lg bg-white/5 animate-pulse mx-1" />
              <div className="h-9 rounded-lg bg-white/5 animate-pulse mx-1" />
            </>
          )}
          {/* Venue Settings — owners and managers (venue permission) */}
          {!sessionLoading && canView("venue") && (
            <button
              onClick={() => router.push("/venue")}
              title={collapsed ? venueName : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                venueActive ? "text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              style={venueActive ? { background: "rgba(22,163,74,0.2)", color: "#4ade80" } : {}}
            >
              <Building2 size={18} className="flex-shrink-0" />
              {!collapsed && (
                <>
                  <span className="truncate">Venue Settings</span>
                  {venueActive && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                  )}
                </>
              )}
            </button>
          )}

          {/* Settings — all authenticated users */}
          {!sessionLoading && (
            <button
              onClick={() => router.push("/settings")}
              title={collapsed ? "Settings" : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                settingsActive ? "text-white" : "text-slate-400 hover:text-white hover:bg-white/5"
              }`}
              style={settingsActive ? { background: "rgba(22,163,74,0.2)", color: "#4ade80" } : {}}
            >
              <Settings size={18} className="flex-shrink-0" />
              {!collapsed && <span>Settings</span>}
              {!collapsed && settingsActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
              )}
            </button>
          )}
        </div>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-white border border-border shadow-sm flex items-center justify-center z-10 hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3.5 bg-white border-b border-border flex-shrink-0">
          {/* Global booking search: Enter opens Bookings filtered by the query */}
          <form
            role="search"
            className={`relative ${canView("bookings") ? "" : "invisible"}`}
            onSubmit={(e) => {
              e.preventDefault();
              const q = topSearch.trim();
              router.push(q ? `/bookings?q=${encodeURIComponent(q)}` : "/bookings");
            }}
          >
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              value={topSearch}
              onChange={(e) => setTopSearch(e.target.value)}
              placeholder="Search bookings…"
              aria-label="Search bookings by customer, phone or booking ID"
              maxLength={100}
              className="pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/20 w-36 sm:w-64 placeholder:text-muted-foreground"
            />
          </form>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <button
              onClick={() => router.push('/settings')}
              className="flex items-center gap-2 pl-3 border-l border-border hover:opacity-75 transition-opacity"
            >
              <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                <User size={14} className="text-green-600" />
              </div>
              <span className="text-sm font-medium hidden sm:inline">{session?.user?.name ?? 'Account'}</span>
            </button>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-9 h-9 rounded-lg hover:bg-muted transition-colors flex items-center justify-center"
              title="Logout"
            >
              <LogOut size={16} className="text-muted-foreground" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}
