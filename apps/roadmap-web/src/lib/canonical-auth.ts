import { validateAuthClaims, type AuthClaims } from '@product-suite/contracts'

const DEFAULT_CLAIMS_COOKIE = 'ps_auth_claims'
const DEFAULT_SIGNATURE_COOKIE = 'ps_auth_sig'
const SENSITIVE_PROVIDER_CLAIM_KEYS = new Set([
  'access_token',
  'id_token',
  'refresh_token',
  'provider_token',
  'session_token',
])

type CookieStoreLike = {
  get(name: string): { value: string } | undefined
}

export type CanonicalAuthFailureCode =
  | 'CANONICAL_AUTH_SESSION_MISSING'
  | 'CANONICAL_AUTH_SESSION_INVALID'

export type CanonicalAuthResult =
  | {
      ok: true
      claims: AuthClaims
    }
  | {
      ok: false
      error: {
        code: CanonicalAuthFailureCode
        missing: string[]
      }
    }

type CanonicalSessionInput = {
  claims?: Record<string, unknown> | null
}

type CanonicalSessionOptions = {
  nowSeconds?: number
}

type CanonicalAuthOptions = {
  secret?: string
  claimsCookieName?: string
  signatureCookieName?: string
}

type SealedCanonicalClaims = {
  claimsCookieName: string
  claimsValue: string
  signatureCookieName: string
  signatureValue: string
}

export function mapCanonicalSessionToAuthClaims(
  input: CanonicalSessionInput,
  options: CanonicalSessionOptions = {},
): CanonicalAuthResult {
  const rawClaims = input.claims
  if (!rawClaims || typeof rawClaims !== 'object' || Array.isArray(rawClaims)) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_MISSING', ['session'])
  }

  const subject = firstString(rawClaims.subject, rawClaims.sub)
  const email = firstString(rawClaims.email)
  const missing = [
    ...(!subject ? ['subject'] : []),
    ...(!email ? ['email'] : []),
  ]

  if (missing.length > 0) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', missing)
  }

  if (isExpired(rawClaims.expires_at, options.nowSeconds)) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', ['expires_at'])
  }

  const validation = validateAuthClaims({
    ...rawClaims,
    provider: firstString(
      rawClaims.provider,
      process.env.ROADMAP_CANONICAL_AUTH_PROVIDER,
      process.env.NEXT_PUBLIC_CANONICAL_AUTH_PROVIDER,
    ) || 'neon',
    subject,
    email,
    tenant_id: firstString(rawClaims.tenant_id, rawClaims.organization_id, rawClaims.org_id),
    provider_claims: sanitizeProviderClaims(rawClaims.provider_claims),
  })

  if (!validation.ok) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', validation.error.missing)
  }

  return {
    ok: true,
    claims: validation.claims,
  }
}

export async function readCanonicalAuthClaimsFromRequest(
  request: Pick<Request, 'headers'>,
  options: CanonicalAuthOptions = {},
): Promise<CanonicalAuthResult> {
  const cookies = parseCookieHeader(request.headers.get('cookie') ?? '')

  return readCanonicalAuthClaimsFromValues({
    claimsValue: cookies.get(resolveClaimsCookieName(options)),
    signatureValue: cookies.get(resolveSignatureCookieName(options)),
    secret: resolveSecret(options),
  })
}

export async function readCanonicalAuthClaimsFromCookieStore(
  cookieStore: CookieStoreLike,
  options: CanonicalAuthOptions = {},
): Promise<CanonicalAuthResult> {
  return readCanonicalAuthClaimsFromValues({
    claimsValue: cookieStore.get(resolveClaimsCookieName(options))?.value,
    signatureValue: cookieStore.get(resolveSignatureCookieName(options))?.value,
    secret: resolveSecret(options),
  })
}

export async function sealCanonicalAuthClaims(
  claims: AuthClaims,
  options: Required<Pick<CanonicalAuthOptions, 'secret'>> & CanonicalAuthOptions,
): Promise<SealedCanonicalClaims> {
  const claimsCookieName = resolveClaimsCookieName(options)
  const signatureCookieName = resolveSignatureCookieName(options)
  const claimsValue = base64UrlEncode(JSON.stringify(claims))
  const signatureValue = await signValue(claimsValue, options.secret)

  return {
    claimsCookieName,
    claimsValue,
    signatureCookieName,
    signatureValue,
  }
}

export function buildCanonicalAuthCookieHeader(sealed: SealedCanonicalClaims) {
  return `${sealed.claimsCookieName}=${sealed.claimsValue}; ${sealed.signatureCookieName}=${sealed.signatureValue}`
}

async function readCanonicalAuthClaimsFromValues({
  claimsValue,
  signatureValue,
  secret,
}: {
  claimsValue?: string
  signatureValue?: string
  secret?: string
}): Promise<CanonicalAuthResult> {
  if (!claimsValue || !signatureValue) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_MISSING', ['session'])
  }
  if (!secret) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', ['secret'])
  }

  const expectedSignature = await signValue(claimsValue, secret)
  if (!timingSafeEqual(signatureValue, expectedSignature)) {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', ['signature'])
  }

  try {
    const claims = JSON.parse(base64UrlDecode(claimsValue))
    return mapCanonicalSessionToAuthClaims({ claims })
  } catch {
    return canonicalAuthError('CANONICAL_AUTH_SESSION_INVALID', ['claims'])
  }
}

function sanitizeProviderClaims(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      ([key]) => !SENSITIVE_PROVIDER_CLAIM_KEYS.has(key.toLowerCase()),
    ),
  )
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return undefined
}

function isExpired(expiresAt: unknown, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (expiresAt === undefined || expiresAt === null) {
    return false
  }

  const expiresAtSeconds =
    typeof expiresAt === 'number' ? expiresAt : Number(String(expiresAt))

  if (!Number.isFinite(expiresAtSeconds)) {
    return true
  }

  return expiresAtSeconds <= nowSeconds
}

function resolveClaimsCookieName(options: CanonicalAuthOptions) {
  return (
    options.claimsCookieName ||
    process.env.ROADMAP_CANONICAL_AUTH_CLAIMS_COOKIE ||
    DEFAULT_CLAIMS_COOKIE
  )
}

function resolveSignatureCookieName(options: CanonicalAuthOptions) {
  return (
    options.signatureCookieName ||
    process.env.ROADMAP_CANONICAL_AUTH_SIGNATURE_COOKIE ||
    DEFAULT_SIGNATURE_COOKIE
  )
}

function resolveSecret(options: CanonicalAuthOptions) {
  return options.secret || process.env.ROADMAP_CANONICAL_AUTH_SECRET
}

function parseCookieHeader(cookieHeader: string) {
  const values = new Map<string, string>()
  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=')
    if (!rawName || rawValue.length === 0) {
      continue
    }
    values.set(rawName, rawValue.join('='))
  }
  return values
}

async function signValue(value: string, secret: string) {
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await globalThis.crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(value),
  )

  return bytesToBase64Url(new Uint8Array(signature))
}

function base64UrlEncode(value: string) {
  return bytesToBase64Url(new TextEncoder().encode(value))
}

function base64UrlDecode(value: string) {
  const bytes = base64UrlToBytes(value)
  return new TextDecoder().decode(bytes)
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) {
    return false
  }

  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

function canonicalAuthError(
  code: CanonicalAuthFailureCode,
  missing: string[],
): CanonicalAuthResult {
  return {
    ok: false,
    error: {
      code,
      missing,
    },
  }
}
