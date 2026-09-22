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

/** Emit only allowlisted transport evidence; never inspect or serialize messages. */
export function reportTransportFailure(
  phase: TransportDiagnosticPhase,
  transport: TransportDiagnosticKind,
  error: unknown,
): void {
  let code: string | 'unknown' = 'unknown'
  let status: number | 'unknown' = 'unknown'
  const pending: unknown[] = [error]
  const visited = new Set<object>()

  while (pending.length > 0 && visited.size < 8) {
    const current = pending.shift()
    if ((typeof current !== 'object' && typeof current !== 'function') || current === null) continue
    if (visited.has(current)) continue
    visited.add(current)

    for (const key of ['code', 'errno']) {
      const candidate = ownValue(current, key)
      if (code === 'unknown' && typeof candidate === 'string' && SAFE_CODES.has(candidate)) code = candidate
    }
    for (const key of ['status', 'statusCode']) {
      const candidate = ownValue(current, key)
      if (status === 'unknown' && Number.isInteger(candidate) && Number(candidate) >= 100 && Number(candidate) <= 599) {
        status = Number(candidate)
      }
    }
    pending.push(ownValue(current, 'cause'), ownValue(current, 'sourceError'), eventErrorValue(current))
  }

  console.error('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', { phase, transport, code, status })
}
