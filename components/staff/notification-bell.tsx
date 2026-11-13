'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'

type Item = { id: string; title: string; body: string | null; link: string | null; read: boolean; createdAt: string }

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Top-bar bell: unread count (polled every minute) and a dropdown of recent notifications. */
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(() => {
    fetch('/api/notifications').then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) { setItems(d.items); setUnread(d.unread) } }).catch(() => {})
  }, [])
  useEffect(() => {
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [load])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const markRead = async (body: { ids?: string[]; all?: boolean }) => {
    await fetch('/api/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {})
    load()
  }

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => { setOpen((o) => !o); if (!open) load() }} aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`}
        className="relative w-9 h-9 rounded-lg hover:bg-muted transition-colors flex items-center justify-center">
        <Bell size={18} className="text-muted-foreground" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-semibold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl border border-border shadow-xl z-50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && <button onClick={() => markRead({ all: true })} className="text-xs text-primary hover:underline">Mark all read</button>}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? <p className="text-sm text-muted-foreground text-center py-8">You&apos;re all caught up.</p> : items.map((n) => (
              <button key={n.id} onClick={() => { if (!n.read) markRead({ ids: [n.id] }); setOpen(false); if (n.link) router.push(n.link) }}
                className={`w-full text-left px-4 py-3 border-b border-border last:border-0 hover:bg-muted/40 ${n.read ? '' : 'bg-green-50/50'}`}>
                <div className="flex items-start gap-2">
                  {!n.read && <span className="mt-1.5 w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{n.title}</p>
                    {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                    <p className="text-[11px] text-muted-foreground mt-1">{ago(n.createdAt)}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>
          <button onClick={() => { setOpen(false); router.push('/settings?tab=notifications') }} className="w-full text-center text-xs text-muted-foreground py-2 border-t border-border hover:bg-muted/40">Notification settings</button>
        </div>
      )}
    </div>
  )
}
