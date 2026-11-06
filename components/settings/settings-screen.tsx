'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { usePermissions } from '@/hooks/use-permissions'
import {
  User, Users, Bell, Camera, Save, Check, Plus, Trash2,
  LogOut, KeyRound, Shield, Edit2, X,
} from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

type PermLevel = 'none' | 'view' | 'edit'

type RolePermissions = {
  bookings: PermLevel
  venue:    PermLevel
  reports:  PermLevel
  billing:  PermLevel
  team:     PermLevel
}

type Role = {
  id: string
  name: string
  color: string
  permissions: RolePermissions
}

type Member = {
  id: string
  name: string
  email: string
  roleId: string | null
  role: Role | null
  initials: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MODULES: { key: keyof RolePermissions; label: string }[] = [
  { key: 'bookings', label: 'Bookings' },
  { key: 'venue',    label: 'Venue'    },
  { key: 'reports',  label: 'Reports'  },
  { key: 'billing',  label: 'Billing'  },
  { key: 'team',     label: 'Team'     },
]

const PERM_LEVELS: PermLevel[] = ['none', 'view', 'edit']

const PERM_LABELS: Record<PermLevel, string> = { none: 'None', view: 'View', edit: 'Edit' }

const PERM_STYLES: Record<PermLevel, string> = {
  none: 'border-border text-muted-foreground',
  view: 'border-blue-300 bg-blue-50 text-blue-700',
  edit: 'border-green-400 bg-green-50 text-green-700',
}

// Defined outside SettingsScreen so React doesn't see a new component type every render
function RolePermEditor({ perms, onChange }: { perms: RolePermissions; onChange: (p: RolePermissions) => void }) {
  return (
    <div className="space-y-2 mt-3">
      {MODULES.map(({ key, label }) => (
        <div key={key} className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground w-24">{label}</span>
          <div className="flex gap-1.5">
            {PERM_LEVELS.map((level) => (
              <button key={level} type="button" onClick={() => onChange({ ...perms, [key]: level })}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition-all ${perms[key] === level ? PERM_STYLES[level] : 'border-border text-muted-foreground hover:border-primary/30'}`}>
                {PERM_LABELS[level]}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

const ROLE_COLORS = ['#16a34a', '#2563eb', '#7c3aed', '#dc2626', '#d97706', '#0891b2']

const defaultPermissions = (): RolePermissions => ({
  bookings: 'view', venue: 'none', reports: 'view', billing: 'none', team: 'none',
})

const ownerSections = [
  { id: 'owner',         label: 'Owner Details',  icon: User   },
  { id: 'team',          label: 'Team Members',   icon: Users  },
  { id: 'roles',         label: 'Roles',          icon: Shield },
  { id: 'notifications', label: 'Notifications',  icon: Bell   },
]

const staffSections = [
  { id: 'owner', label: 'My Profile', icon: User },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uploadAvatar(file: File): Promise<string> {
  const fd = new FormData()
  fd.append('file', file)
  const res = await fetch('/api/upload', { method: 'POST', body: fd })
  if (!res.ok) throw new Error('Upload failed')
  return (await res.json()).url as string
}

function initials(name: string) {
  return name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
}

function Toggle({ on, onChange }: { on: boolean; onChange: () => void }) {
  return (
    <div onClick={onChange}
      className={`relative w-10 h-5 rounded-full cursor-pointer transition-colors ${on ? 'bg-primary' : 'bg-muted'}`}>
      <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${on ? 'left-5' : 'left-0.5'}`} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsScreen() {
  const router = useRouter()
  const { data: session } = useSession()
  const { isOwner } = usePermissions()

  const [active, setActive] = useState('owner')

  // Owner
  const [ownerName,     setOwnerName]     = useState('')
  const [ownerEmail,    setOwnerEmail]    = useState('')
  const [ownerPhone,    setOwnerPhone]    = useState('')
  const [facilityName,  setFacilityName]  = useState('')
  const [avatarUrl,     setAvatarUrl]     = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)

  // Team
  const [members,     setMembers]     = useState<Member[]>([])
  const [showInvite,  setShowInvite]  = useState(false)
  const [inviteName,  setInviteName]  = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRoleId,setInviteRoleId]= useState<string | null>(null)
  const [memberError, setMemberError] = useState('')

  // Roles
  const [roles,        setRoles]        = useState<Role[]>([])
  const [editingRole,  setEditingRole]  = useState<Role | null>(null)
  const [newRoleName,  setNewRoleName]  = useState('')
  const [showNewRole,  setShowNewRole]  = useState(false)
  const [newRolePerms, setNewRolePerms] = useState<RolePermissions>(defaultPermissions())
  const [newRoleColor, setNewRoleColor] = useState(ROLE_COLORS[0])
  const [roleError,    setRoleError]    = useState('')

  // Notifications
  const [notifs, setNotifs] = useState({
    newBooking: false, cancellation: false, payment: false, checkin: false,
    dailySummary: false, weeklySummary: false, lowOccupancy: false, smsAlerts: false,
  })

  // Save
  const [venueId, setVenueId] = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [creating, setCreating] = useState(false)

  const sections = isOwner ? ownerSections : staffSections

  const displayName  = ownerName  || session?.user?.name  || ''
  const displayEmail = ownerEmail || session?.user?.email || ''

  // Load profile + venue data once session is resolved
  const { status: sessionStatus } = useSession()
  useEffect(() => {
    if (sessionStatus === 'loading') return

    // Always load the user's own profile for personal fields
    fetch('/api/users/me')
      .then((r) => r.json())
      .then((u) => { if (!u.error && isOwner) setOwnerPhone(u.phone ?? '') })
      .catch(() => {})

    fetch('/api/venues')
      .then((r) => r.json())
      .then((venues) => {
        const v = venues[0]
        if (!v) return
        setVenueId(v.id)
        setFacilityName(v.name ?? '')

        // For owners, phone comes from the venue record
        if (isOwner) {
          setOwnerPhone(v.phone ?? '')
        }

        // Load roles (always — staff see them read-only)
        fetch(`/api/venues/${v.id}/roles`)
          .then((r) => r.json())
          .then((rolesData) => {
            setRoles(rolesData.map((r: { id: string; name: string; color: string; permissions: RolePermissions }) => ({
              id: r.id, name: r.name, color: r.color, permissions: r.permissions as RolePermissions,
            })))
          }).catch(() => {})

        // Load members (owners only)
        if (isOwner) {
          fetch(`/api/venues/${v.id}/members`)
            .then((r) => r.json())
            .then((membersData) => {
              setMembers(membersData.map((m: { id: string; name: string; email: string; roleId: string | null; role: Role | null }) => ({
                id: m.id, name: m.name, email: m.email,
                roleId: m.roleId, role: m.role,
                initials: initials(m.name),
              })))
            }).catch(() => {})
        }
      })
      .catch(() => {})

    fetch('/api/users/notifications')
      .then((r) => r.json())
      .then((prefs) => {
        if (prefs.error) return
        setNotifs({
          newBooking: prefs.newBooking ?? false, cancellation: prefs.cancellation ?? false,
          payment: prefs.payment ?? false, checkin: prefs.checkin ?? false,
          dailySummary: prefs.dailySummary ?? false, weeklySummary: prefs.weeklySummary ?? false,
          lowOccupancy: prefs.lowOccupancy ?? false, smsAlerts: prefs.smsAlerts ?? false,
        })
      })
      .catch(() => {})
  }, [sessionStatus, isOwner])

  const handleAvatarFile = async (file: File) => {
    setAvatarUploading(true)
    try { setAvatarUrl(await uploadAvatar(file)) } catch { /* silent */ }
    finally { setAvatarUploading(false) }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      if (active === 'owner') {
        if (isOwner && venueId) {
          await fetch(`/api/venues/${venueId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: facilityName, phone: ownerPhone }),
          })
        } else {
          await fetch('/api/users/me', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: ownerName, phone: ownerPhone }),
          })
        }
      }
      if (active === 'notifications') {
        await fetch('/api/users/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(notifs),
        })
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } finally {
      setSaving(false)
    }
  }

  const addMember = async () => {
    if (!inviteName.trim() || !inviteEmail.trim() || !venueId) return
    setMemberError('')
    try {
      const res = await fetch(`/api/venues/${venueId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: inviteName.trim(), email: inviteEmail.trim(), roleId: inviteRoleId }),
      })
      if (!res.ok) { setMemberError((await res.json()).error ?? 'Failed to add member'); return }
      const m = await res.json()
      setMembers((prev) => [...prev, { id: m.id, name: m.name, email: m.email, roleId: m.roleId, role: m.role, initials: initials(m.name) }])
      setInviteName(''); setInviteEmail(''); setInviteRoleId(null); setShowInvite(false)
    } catch { setMemberError('Something went wrong') }
  }

  const removeMember = async (memberId: string) => {
    if (!venueId) return
    await fetch(`/api/venues/${venueId}/members/${memberId}`, { method: 'DELETE' })
    setMembers((prev) => prev.filter((m) => m.id !== memberId))
  }

  const createRole = async () => {
    if (!newRoleName.trim()) { setRoleError('Role name is required'); return }
    if (!venueId) { setRoleError('Venue not loaded yet — try again in a moment'); return }
    setRoleError('')
    setCreating(true)
    try {
      const res = await fetch(`/api/venues/${venueId}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newRoleName.trim(), color: newRoleColor, permissions: newRolePerms }),
      })
      if (!res.ok) { setRoleError((await res.json()).error ?? 'Failed to create role'); return }
      const r = await res.json()
      setRoles((prev) => [...prev, { id: r.id, name: r.name, color: r.color, permissions: r.permissions as RolePermissions }])
      setNewRoleName(''); setNewRolePerms(defaultPermissions()); setNewRoleColor(ROLE_COLORS[0]); setShowNewRole(false)
    } catch { setRoleError('Something went wrong') }
    finally { setCreating(false) }
  }

  const saveEditingRole = async () => {
    if (!editingRole || !venueId) return
    try {
      const res = await fetch(`/api/venues/${venueId}/roles/${editingRole.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editingRole.name, color: editingRole.color, permissions: editingRole.permissions }),
      })
      if (!res.ok) return
      const r = await res.json()
      setRoles((prev) => prev.map((role) => role.id === r.id ? { ...role, name: r.name, color: r.color, permissions: r.permissions as RolePermissions } : role))
      setEditingRole(null)
    } catch { /* silent */ }
  }

  const deleteRole = async (id: string) => {
    if (!venueId) return
    const res = await fetch(`/api/venues/${venueId}/roles/${id}`, { method: 'DELETE' })
    if (!res.ok) return
    setRoles((prev) => prev.filter((r) => r.id !== id))
    setMembers((prev) => prev.map((m) => m.roleId === id ? { ...m, roleId: null, role: null } : m))
  }

  const inp = 'w-full px-4 py-2.5 rounded-lg border border-border bg-white text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary'

  return (
    <div className="flex h-full bg-muted">
      {/* Sidebar */}
      <nav className="w-56 flex-shrink-0 bg-white border-r border-border py-5">
        <p className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Account Settings</p>
        {sections.map((s) => {
          const Icon = s.icon
          const isActive = active === s.id
          return (
            <button key={s.id} onClick={() => setActive(s.id)}
              className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-all ${isActive ? 'bg-green-50 text-green-700 border-r-2 border-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`}>
              <Icon size={15} />
              {s.label}
            </button>
          )
        })}
      </nav>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-2xl">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-foreground">{sections.find((s) => s.id === active)?.label}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {active === 'owner'         && 'Your profile and account security'}
                {active === 'team'          && 'Invite and manage team members'}
                {active === 'roles'         && 'Create roles and set permissions'}
                {active === 'notifications' && 'Choose which alerts you receive'}
              </p>
            </div>
            {(active === 'notifications' || (active === 'owner' && isOwner)) && (
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 transition-all"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                {saved ? <><Check size={14} /> Saved</> : saving ? 'Saving…' : <><Save size={14} /> Save</>}
              </button>
            )}
          </div>

          {/* ── Owner Details ── */}
          {active === 'owner' && (
            <div className="space-y-5">
              <div className="bg-white rounded-xl border border-border p-6">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-5">Profile</p>

                {/* Avatar */}
                <div className="flex items-center gap-4 mb-6">
                  <div className="relative">
                    <div className="w-16 h-16 rounded-full overflow-hidden bg-green-500/10 flex items-center justify-center">
                      {avatarUrl
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
                        : <span className="text-xl font-semibold text-green-600">{initials(displayName) || '?'}</span>}
                    </div>
                    {avatarUploading && (
                      <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      </div>
                    )}
                    <button onClick={() => avatarRef.current?.click()}
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-primary text-white flex items-center justify-center shadow hover:opacity-90 transition-opacity">
                      <Camera size={11} />
                    </button>
                    <input ref={avatarRef} type="file" accept="image/*" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleAvatarFile(f) }} />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{displayName || 'Your Name'}</p>
                    <p className="text-sm text-muted-foreground">{displayEmail}</p>
                    {isOwner
                      ? <span className="mt-1 inline-block px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200 text-xs font-medium">Owner</span>
                      : <span className="mt-1 inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-medium">Team Member</span>
                    }
                  </div>
                </div>

                {isOwner ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Full Name</label>
                      <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)}
                        placeholder={session?.user?.name ?? 'Your name'} className={inp} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Email</label>
                      <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)}
                        type="email" placeholder={session?.user?.email ?? 'your@email.com'} className={inp} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Phone</label>
                      <input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)}
                        placeholder="+1 (555) 000-0000" className={inp} />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5">Facility Name</label>
                      <input value={facilityName} onChange={(e) => setFacilityName(e.target.value)}
                        placeholder="Your venue name" className={inp} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">Full Name</p>
                      <p className="text-sm text-foreground">{displayName || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-0.5">Email</p>
                      <p className="text-sm text-foreground">{displayEmail || '—'}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Password */}
              <div className="bg-white rounded-xl border border-border p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Password</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Change your account password via email verification</p>
                </div>
                <button
                  onClick={() => router.push(`/forgot-password?email=${encodeURIComponent(displayEmail)}`)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-medium text-foreground hover:bg-muted transition-colors">
                  <KeyRound size={14} /> Change Password
                </button>
              </div>

              {/* Sign out */}
              <div className="bg-white rounded-xl border border-red-100 p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Sign Out</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Sign out of your account on this device</p>
                </div>
                <button
                  onClick={() => { void (async () => { const { signOut } = await import('next-auth/react'); signOut({ callbackUrl: '/login' }) })() }}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors">
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </div>
          )}

          {/* ── Team Members ── */}
          {active === 'team' && (
            <div className="space-y-3">
              {/* Owner row */}
              <div className="bg-white rounded-xl border border-border p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center text-sm font-semibold text-green-700">
                    {initials(displayName) || <User size={14} />}
                  </div>
                  <div>
                    <p className="text-sm font-medium">{displayName || 'You'} <span className="text-xs text-muted-foreground">(you)</span></p>
                    <p className="text-xs text-muted-foreground">{displayEmail}</p>
                  </div>
                </div>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border bg-purple-50 text-purple-700 border-purple-200">Owner</span>
              </div>

              {members.map((m) => {
                const role = roles.find((r) => r.id === m.roleId)
                return (
                  <div key={m.id} className="bg-white rounded-xl border border-border p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-sm font-semibold text-blue-700">{m.initials}</div>
                      <div>
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {role
                        ? <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border" style={{ color: role.color, borderColor: role.color + '55', background: role.color + '10' }}>{role.name}</span>
                        : <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border border-border text-muted-foreground">No role</span>}
                      <button onClick={() => removeMember(m.id)}
                        className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                )
              })}

              {/* Invite form */}
              {showInvite ? (
                <div className="bg-white rounded-xl border border-border p-5 space-y-3">
                  <p className="text-sm font-semibold">Invite Team Member</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Full Name</label>
                      <input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Jane Smith" className={inp} />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-muted-foreground mb-1">Email</label>
                      <input type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="jane@example.com" className={inp} />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-muted-foreground mb-1">Role</label>
                    {roles.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No roles yet — <button onClick={() => { setShowInvite(false); setActive('roles') }} className="text-primary underline">create a role first</button></p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => setInviteRoleId(null)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${inviteRoleId === null ? 'border-border bg-muted text-foreground' : 'border-border text-muted-foreground'}`}>
                          No role
                        </button>
                        {roles.map((r) => (
                          <button key={r.id} type="button" onClick={() => setInviteRoleId(r.id)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all`}
                            style={inviteRoleId === r.id ? { color: r.color, borderColor: r.color, background: r.color + '10' } : {}}>
                            {r.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {memberError && <p className="text-xs text-red-500 mt-1">{memberError}</p>}
                  <div className="flex gap-2 pt-1">
                    <button onClick={addMember}
                      className="flex-1 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
                      style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                      Add Member
                    </button>
                    <button onClick={() => setShowInvite(false)}
                      className="px-4 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setShowInvite(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all bg-white">
                  <Plus size={15} /> Invite Team Member
                </button>
              )}
            </div>
          )}

          {/* ── Roles ── */}
          {active === 'roles' && (
            <div className="space-y-3">
              {roles.map((role) => (
                <div key={role.id} className="bg-white rounded-xl border border-border overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <div className="w-3 h-3 rounded-full" style={{ background: role.color }} />
                      <span className="text-sm font-semibold">{role.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {members.filter((m) => m.roleId === role.id).length} member{members.filter((m) => m.roleId === role.id).length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-2">
                        <button onClick={() => setEditingRole(editingRole?.id === role.id ? null : { ...role })}
                          className="w-7 h-7 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors">
                          <Edit2 size={13} />
                        </button>
                        <button onClick={() => deleteRole(role.id)}
                          className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center text-muted-foreground hover:text-red-500 transition-colors">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Permission summary chips */}
                  {editingRole?.id !== role.id && (
                    <div className="px-5 pb-4 flex flex-wrap gap-1.5">
                      {MODULES.map(({ key, label }) => (
                        role.permissions[key] !== 'none' && (
                          <span key={key} className={`px-2 py-0.5 rounded-md text-xs font-medium border ${PERM_STYLES[role.permissions[key]]}`}>
                            {label}: {PERM_LABELS[role.permissions[key]]}
                          </span>
                        )
                      ))}
                      {MODULES.every(({ key }) => role.permissions[key] === 'none') && (
                        <span className="text-xs text-muted-foreground">No permissions</span>
                      )}
                    </div>
                  )}

                  {/* Edit panel */}
                  {editingRole?.id === role.id && (
                    <div className="px-5 pb-5 border-t border-border">
                      <div className="flex items-center gap-3 mt-4 mb-5">
                        <input value={editingRole.name} onChange={(e) => setEditingRole({ ...editingRole, name: e.target.value })}
                          className="flex-1 px-3 py-1.5 rounded-lg border border-border text-sm font-medium outline-none focus:ring-2 focus:ring-primary/20" />
                        <div className="flex gap-3">
                          {ROLE_COLORS.map((c) => (
                            <button key={c} type="button" onClick={() => setEditingRole({ ...editingRole, color: c })}
                              className={`w-5 h-5 rounded-full transition-all ${editingRole.color === c ? 'scale-[1.2]' : 'hover:scale-110'}`}
                              style={{ background: c, boxShadow: editingRole.color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'none' }} />
                          ))}
                        </div>
                      </div>
                      <RolePermEditor perms={editingRole.permissions}
                        onChange={(p) => setEditingRole({ ...editingRole, permissions: p })} />
                      <div className="flex gap-2 mt-4">
                        <button onClick={saveEditingRole}
                          className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
                          style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                          <Check size={13} /> Save
                        </button>
                        <button onClick={() => setEditingRole(null)}
                          className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {/* Create role */}
              {showNewRole ? (
                <div className="bg-white rounded-xl border border-border p-5">
                  <p className="text-sm font-semibold mb-3">New Role</p>
                  <div className="flex items-center gap-3 mb-4">
                    <input value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)}
                      placeholder="e.g. Front Desk, Coach, Manager"
                      className="flex-1 px-3 py-2 rounded-lg border border-border text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                    <div className="flex gap-3">
                      {ROLE_COLORS.map((c) => (
                        <button key={c} type="button" onClick={() => setNewRoleColor(c)}
                          className={`w-5 h-5 rounded-full transition-all ${newRoleColor === c ? 'scale-[1.2]' : 'hover:scale-110'}`}
                          style={{ background: c, boxShadow: newRoleColor === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : 'none' }} />
                      ))}
                    </div>
                  </div>
                  <RolePermEditor perms={newRolePerms} onChange={setNewRolePerms} />
                  {roleError && <p className="text-xs text-red-500 mt-3">{roleError}</p>}
                  <div className="flex gap-2 mt-4">
                    <button onClick={createRole} disabled={creating}
                      className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 transition-all"
                      style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                      <Plus size={13} /> {creating ? 'Creating…' : 'Create Role'}
                    </button>
                    <button onClick={() => setShowNewRole(false)}
                      className="px-3 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : isOwner ? (
                <button onClick={() => setShowNewRole(true)}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-border text-sm font-medium text-muted-foreground hover:border-primary/40 hover:text-primary transition-all bg-white">
                  <Plus size={15} /> Create Role
                </button>
              ) : null}
            </div>
          )}

          {/* ── Notifications ── */}
          {active === 'notifications' && (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              {([
                { key: 'newBooking',    label: 'New Booking',        desc: 'When a new booking is created' },
                { key: 'cancellation',  label: 'Cancellation Alert',  desc: 'When a booking is cancelled' },
                { key: 'payment',       label: 'Payment Received',    desc: 'When a payment is processed' },
                { key: 'checkin',       label: 'Check-in Reminder',   desc: '30 minutes before a booking' },
                { key: 'dailySummary',  label: 'Daily Summary',       desc: 'End-of-day booking report' },
                { key: 'weeklySummary', label: 'Weekly Report',       desc: 'Weekly revenue and analytics' },
                { key: 'lowOccupancy',  label: 'Low Occupancy Alert', desc: 'When occupancy drops below 40%' },
                { key: 'smsAlerts',     label: 'SMS Alerts',          desc: 'Receive critical alerts via SMS' },
              ] as const).map((n, i, arr) => (
                <div key={n.key} className={`flex items-center justify-between px-5 py-4 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div>
                    <p className="text-sm font-medium">{n.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{n.desc}</p>
                  </div>
                  <Toggle on={notifs[n.key]} onChange={() => setNotifs((prev) => ({ ...prev, [n.key]: !prev[n.key] }))} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
