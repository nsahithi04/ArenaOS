"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut, SessionProvider, useSession } from "next-auth/react";
import { Toaster } from "sonner";
import { Logo } from "@/components/brand/logo";
import { usePermissions } from "@/hooks/use-permissions";
import {
  LayoutDashboard,
  Calendar,
  BookOpen,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bell,
  Search,
  User,
  Building2,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/calendar", label: "Booking Calendar", icon: Calendar },
  { href: "/bookings", label: "Bookings", icon: BookOpen },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
      <Toaster position="top-right" richColors closeButton />
    </SessionProvider>
  );
}

function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [venueName, setVenueName] = useState("Your Venue");
  const pathname = usePathname();
  const router = useRouter();

  // Start collapsed on phone-sized screens so content has room.
  useEffect(() => {
    if (window.innerWidth < 768) setCollapsed(true);
  }, []);

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
        <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto">
          {sessionLoading
            ? navItems.map((item) => (
                <div
                  key={item.href}
                  className="h-9 rounded-lg bg-white/5 animate-pulse mx-1"
                />
              ))
            : navItems
            .filter((item) => {
              if (["/dashboard", "/calendar", "/bookings"].includes(item.href)) {
                return canView("bookings");
              }
              return true;
            })
            .map((item) => {
              const Icon = item.icon;
              const active = pathname.startsWith(item.href);
              return (
                <button
                  key={item.href}
                  onClick={() => router.push(item.href)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-sm font-medium ${
                    active
                      ? "text-white"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                  style={active ? { background: "rgba(22,163,74,0.2)", color: "#4ade80" } : {}}
                  title={collapsed ? item.label : undefined}
                >
                  <Icon size={18} className="flex-shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                  {!collapsed && active && (
                    <span className="ml-auto w-1.5 h-1.5 rounded-full bg-green-400" />
                  )}
                </button>
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
          {/* Venue Settings — owners only */}
          {!sessionLoading && canView("venue") && isOwner && (
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
          className="absolute -right-3 top-16 w-6 h-6 rounded-full bg-white border border-border shadow-sm flex items-center justify-center z-10 hover:bg-muted transition-colors"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <header className="flex items-center justify-between gap-2 px-3 sm:px-6 py-3.5 bg-white border-b border-border flex-shrink-0">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              placeholder="Search bookings, courts..."
              className="pl-9 pr-4 py-2 text-sm bg-muted rounded-lg border-0 outline-none focus:ring-2 focus:ring-primary/20 w-36 sm:w-64 placeholder:text-muted-foreground"
            />
          </div>
          <div className="flex items-center gap-3">
            <button className="relative w-9 h-9 rounded-lg hover:bg-muted transition-colors flex items-center justify-center">
              <Bell size={18} className="text-muted-foreground" />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-red-500" />
            </button>
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
