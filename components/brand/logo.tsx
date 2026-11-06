export function Logo({ size = 'md', dark = false, className }: { size?: 'sm' | 'md' | 'lg'; dark?: boolean; className?: string }) {
  const sizes = { sm: { icon: 24, text: 'text-base' }, md: { icon: 32, text: 'text-xl' }, lg: { icon: 40, text: 'text-2xl' } }
  const s = sizes[size]
  return (
    <div className={`flex items-center gap-2.5${className ? ` ${className}` : ''}`}>
      <div
        className="rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ width: s.icon, height: s.icon, background: 'linear-gradient(135deg, #16a34a 0%, #2563eb 100%)' }}
      >
        <svg width={s.icon * 0.6} height={s.icon * 0.6} viewBox="0 0 20 20" fill="none">
          <path d="M10 2L3 7v6l7 5 7-5V7L10 2z" fill="white" fillOpacity="0.9" />
          <circle cx="10" cy="10" r="2.5" fill="white" />
        </svg>
      </div>
      <span className={`${s.text} font-semibold tracking-tight ${dark ? 'text-white' : 'text-foreground'}`}>
        Game<span style={{ color: '#16a34a' }}>On</span>
      </span>
    </div>
  )
}
