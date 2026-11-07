import { AsyncLocalStorage } from 'node:async_hooks'
import diagnosticsChannel from 'node:diagnostics_channel'

export type TransportDiagnosticPhase = 'prepare' | 'session-connect'
export type TransportDiagnosticKind = 'http' | 'websocket'

export type TransportEvidence = Readonly<{ code: string; status: number | 'unknown' }>

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
const TRANSPORT_CHANNEL_NAMES = [
  'undici:request:create',
  'undici:request:headers',
  'undici:request:error',
  'undici:client:connectError',
] as const
const transportScope = new AsyncLocalStorage<symbol>()

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

const transportEvidence = (error: unknown): TransportEvidence => {
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

const safeRuntimeVersion = (value: unknown): string => (
  typeof value === 'string' && value.length <= 64 && /^v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value)
    ? value
    : 'unknown'
)

const runtime = Object.freeze({
  node: safeRuntimeVersion(process.version),
  undici: safeRuntimeVersion(process.versions.undici),
})

const observedEvidence = (evidence: TransportEvidence | undefined): TransportEvidence => ({
  code: typeof evidence?.code === 'string' && SAFE_CODES.has(evidence.code) ? evidence.code : 'unknown',
  status: typeof evidence?.status === 'number' && safeStatusFrom({ status: evidence.status }) !== undefined
    ? evidence.status
    : 'unknown',
})

type DiagnosticHandler = (message: unknown, name: string | symbol) => void

function scopedHandler(token: symbol, handler: (message: unknown) => void): DiagnosticHandler {
  return (message) => {
    try {
      if (transportScope.getStore() === token) handler(message)
    } catch {
      return
    }
  }
}

/** Observe only safe Undici evidence produced by one async session-connect operation. */
export function createSessionTransportObservation(): {
  readonly evidence: TransportEvidence
  run<T>(operation: () => Promise<T>): Promise<T>
} {
  const token = Symbol('session-transport')
  const requests = new WeakSet<object>()
  let code = 'unknown'
  let status: number | 'unknown' = 'unknown'

  const handlers: Record<(typeof TRANSPORT_CHANNEL_NAMES)[number], DiagnosticHandler> = {
    'undici:request:create': scopedHandler(token, (message) => {
      const request = isInspectable(message) ? ownValue(message, 'request') : undefined
      if (isInspectable(request)) requests.add(request)
    }),
    'undici:request:headers': scopedHandler(token, (message) => {
      if (!isInspectable(message) || !requests.has(ownValue(message, 'request') as object)) return
      const response = ownValue(message, 'response')
      if (status === 'unknown' && isInspectable(response)) status = safeStatusFrom(response) ?? status
    }),
    'undici:request:error': scopedHandler(token, (message) => {
      if (!isInspectable(message) || !requests.has(ownValue(message, 'request') as object)) return
      const error = ownValue(message, 'error')
      if (code === 'unknown' && isInspectable(error)) code = safeCodeFrom(error) ?? code
    }),
    'undici:client:connectError': scopedHandler(token, (message) => {
      const error = isInspectable(message) ? ownValue(message, 'error') : undefined
      if (code === 'unknown' && isInspectable(error)) code = safeCodeFrom(error) ?? code
    }),
  }

  return {
    get evidence() {
      return { code, status }
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const subscriptions: Array<{ channel: ReturnType<typeof diagnosticsChannel.channel>; handler: DiagnosticHandler }> = []
      for (const name of TRANSPORT_CHANNEL_NAMES) {
        try {
          const diagnostic = diagnosticsChannel.channel(name)
          diagnostic.subscribe(handlers[name])
          subscriptions.push({ channel: diagnostic, handler: handlers[name] })
        } catch {
          continue
        }
      }
      try {
        return await transportScope.run(token, operation)
      } finally {
        for (const subscription of subscriptions) {
          try {
            subscription.channel.unsubscribe(subscription.handler)
          } catch {
            continue
          }
        }
      }
    },
  }
}

/** Emit only allowlisted transport evidence; never inspect or serialize messages. */
export function reportTransportFailure(
  phase: TransportDiagnosticPhase,
  transport: TransportDiagnosticKind,
  error: unknown,
  observation?: TransportEvidence,
): void {
  const primary = transportEvidence(error)
  const observed = observedEvidence(observation)
  const code = primary.code === 'unknown' ? observed.code : primary.code
  const status = primary.status === 'unknown' ? observed.status : primary.status
  try {
    console.error('DB_CONTRACT_TRANSPORT_DIAGNOSTIC', { phase, transport, code, status, runtime })
  } catch {
    return
  }
}
