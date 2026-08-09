import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const contract = JSON.parse(readFileSync(new URL('../config/database-authority.json', import.meta.url), 'utf8'))
const NEON_HOST = /^ep-([a-z0-9-]+?)(-pooler)?\.[a-z0-9-]+\.aws\.neon\.tech$/

function failure(code) {
  return { ok: false, code }
}

export function parseNeonUrl(value, purpose) {
  if (typeof value !== 'string' || !value) throw new Error('DATABASE_URL_INVALID')
  if (!['runtime', 'migration'].includes(purpose)) throw new Error('DATABASE_PURPOSE_INVALID')

  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error('DATABASE_URL_INVALID')
  }

  const host = NEON_HOST.exec(url.hostname)
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !host) throw new Error('DATABASE_PROVIDER_INVALID')
  if (url.pathname !== `/${contract.database}`) throw new Error('DATABASE_NAME_INVALID')
  if (!['require', 'verify-ca', 'verify-full'].includes(url.searchParams.get('sslmode'))) throw new Error('DATABASE_TLS_REQUIRED')

  const pooled = Boolean(host[2])
  if ((purpose === 'runtime' && !pooled) || (purpose === 'migration' && pooled)) throw new Error('DATABASE_PURPOSE_INVALID')
  return { provider: contract.provider, purpose, endpointId: host[1] }
}

export function validateDatabaseAuthority({ environment, databaseUrl, migrationDatabaseUrl, databaseUrlSecondary, historyVariant }) {
  const expectedVariant = contract.environmentHistoryPins[environment]
  if (!expectedVariant) return failure('ENVIRONMENT_UNDECLARED')
  if (databaseUrlSecondary) return failure('DATABASE_AUTHORITY_DUPLICATE')
  if (historyVariant !== expectedVariant) return failure('HISTORY_VARIANT_MISMATCH')

  try {
    const runtime = parseNeonUrl(databaseUrl, 'runtime')
    const migration = parseNeonUrl(migrationDatabaseUrl, 'migration')
    if (runtime.provider !== migration.provider || runtime.endpointId !== migration.endpointId) return failure('DATABASE_AUTHORITY_MISMATCH')
    return { ok: true, provider: contract.provider, schema: contract.schema, historyVariant, endpoints: [runtime, migration] }
  } catch (error) {
    return failure(error instanceof Error ? error.message : 'DATABASE_URL_INVALID')
  }
}

function cliOptions(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    if (!['--environment', '--history-variant'].includes(key) || !args[index + 1]) return null
    options[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = args[index + 1]
  }
  return options
}

function main() {
  const options = cliOptions(process.argv.slice(2))
  const result = validateDatabaseAuthority({
    environment: options?.environment,
    historyVariant: options?.historyVariant,
    databaseUrl: process.env.DATABASE_URL,
    migrationDatabaseUrl: process.env.MIGRATION_DATABASE_URL,
    databaseUrlSecondary: process.env.DATABASE_URL_SECONDARY,
  })
  if (!result.ok) {
    console.error(`status=error code=${result.code}`)
    process.exitCode = 1
    return
  }
  for (const endpoint of result.endpoints) {
    console.log(`status=ok provider=${endpoint.provider} purpose=${endpoint.purpose} endpoint_id=${endpoint.endpointId}`)
  }
  console.log(`schema=${result.schema} migration_root=${contract.drizzle.migrationRoot} history_variant=${result.historyVariant}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()
