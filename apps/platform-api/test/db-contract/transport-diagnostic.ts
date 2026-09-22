export type TransportDiagnosticPhase = 'prepare' | 'session-connect'
export type TransportDiagnosticKind = 'http' | 'websocket'

const SAFE_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EPIPE',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ETIMEDOUT',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UND_ERR_ABORTED',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_DESTROYED',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_RESPONSE_STATUS_CODE',
  'UND_ERR_SOCKET',
])

const ownValue = (value: object, key: string): unknown => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}

const eventErrorValue = (value: object): unknown => {
  try {
    return typeof Event !== 'undefined' && value instanceof Event
      ? (value as Event & { error?: unknown }).error
      : undefined
  } catch {
    return undefined
  }
}

const isInspectable = (value: unknown): value is object => (
  (typeof value === 'object' && value !== null) || typeof value === 'function'
)

const safeCodeFrom = (value: object): string | undefined => {
  for (const key of ['code', 'errno']) {
    const candidate = ownValue(value, key)
    if (typeof candidate === 'string' && SAFE_CODES.has(candidate)) return candidate
  }
  return undefined
}

const safeStatusFrom = (value: object): number | undefined => {
  for (const key of ['status', 'statusCode']) {
    const candidate = ownValue(value, key)
    if (Number.isInteger(candidate) && Number(candidate) >= 100 && Number(candidate) <= 599) return Number(candidate)
  }
  return undefined
}

const transportEvidence = (error: unknown): { code: string; status: number | 'unknown' } => {
  let code = 'unknown'
  let status: number | 'unknown' = 'unknown'
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0 && visited.size < 8) {
    const current = pending.shift()
    if (!isInspectable(current) || visited.has(current)) continue
    visited.add(current)

    code = code === 'unknown' ? (safeCodeFrom(current) ?? code) : code
    status = status === 'unknown' ? (safeStatusFrom(current) ?? status) : status
    pending.push(ownValue(current, 'cause'), ownValue(current, 'sourceError'), eventErrorValue(current))
  }

  return { code, status }
}

/** Emit only allowlisted transport evidence; never inspect or serialize messages. */
export function reportTransportFailure(
  phase: TransportDiagnosticPhase,
  transport: TransportDiagnosticKind,
  error: unknown,
): void {
  const { code, status } = transportEvidence(error)
  try {
    console.error('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', { phase, transport, code, status })
  } catch {
    return
  }
}
