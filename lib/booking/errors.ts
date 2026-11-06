export class ServiceError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export class ConflictError extends ServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(409, 'SLOT_CONFLICT', message, details)
  }
}

/** True when PostgreSQL rejected a write because of an exclusion constraint (SQLSTATE 23P01). */
export function isExclusionViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  const meta = (err as { meta?: { code?: string } })?.meta
  return meta?.code === '23P01' || /23P01|exclusion constraint|_no_overlap/i.test(msg)
}
