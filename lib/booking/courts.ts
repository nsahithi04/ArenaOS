// Court display names. Two courts may share a name when they are for different
// sports, so wherever a court is shown on its own its sport goes with it.

export function courtLabel(name: string, sportName?: string | null) {
  return sportName ? `${name} · ${sportName}` : name
}

/** Prisma select fragment that carries what courtLabel needs. */
export const courtLabelSelect = { name: true, sport: { select: { name: true } } } as const

export function labelOf(c: { name: string; sport?: { name: string } | null }) {
  return courtLabel(c.name, c.sport?.name)
}

/** Normalised key for "same name": case and surrounding/double spaces ignored. */
export function courtNameKey(name: string) {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

export type CourtNameProblem = { index: number; message: string }

/**
 * Checks a list of courts for blank names and for two courts of the same sport
 * sharing a name (case-insensitive). Courts of different sports may share a name.
 * Returns one problem per offending court, in list order.
 */
export function courtNameProblems(courts: { name: string; sportId?: string | null }[], sportName: (sportId: string | null) => string = () => ''): CourtNameProblem[] {
  const out: CourtNameProblem[] = []
  const seen = new Map<string, number>()
  courts.forEach((c, index) => {
    const key = courtNameKey(c.name ?? '')
    if (!key) { out.push({ index, message: 'Court name is required.' }); return }
    if (key.length > 80) { out.push({ index, message: 'Court name is too long (80 characters max).' }); return }
    const k = `${c.sportId ?? ''}|${key}`
    if (seen.has(k)) {
      const sport = sportName(c.sportId ?? null)
      out.push({ index, message: `Two ${sport ? `${sport} ` : ''}courts are named "${c.name.trim()}". Use a different name for each court of the same sport.` })
    } else seen.set(k, index)
  })
  return out
}
