/** FNV-1a hash of a string → a stable value in [0,1). No RNG (deterministic + auditable). */
export function hashUnitInterval(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // >>> 0 → unsigned 32-bit; divide by 2^32 for [0,1).
  return (h >>> 0) / 0x100000000
}

/** Per-run holdout rate (fraction assigned memory-off). Env-overridable; 0 disables. */
export const MEMORY_HOLDOUT_RATE = (() => {
  const raw = Number(process.env.MEMORY_HOLDOUT_RATE)
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.1
})()

/**
 * Deterministic holdout assignment, keyed on the THREAD (so a whole conversation is
 * consistently memory-on or memory-off — no within-thread spillover, and a retried
 * turn keeps its assignment). Thread-less/autonomous runs key on their own runId.
 */
export function assignHoldout(threadId: string | null, runId: string): boolean {
  if (MEMORY_HOLDOUT_RATE <= 0) return false
  return hashUnitInterval(threadId ?? runId) < MEMORY_HOLDOUT_RATE
}
