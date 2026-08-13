import { Hono, type Context } from 'hono'

import {
  parseCommandExecuteRequest,
  parseCommandPreviewRequest,
  type CommandExecuteRequest,
  type CommandRequest,
} from '@product-suite/contracts'

import { sqlFrom } from '../db'
import type { AuthedEnv } from '../middleware/clerk-auth'
import { commandRegistryDependencies } from './dependencies'
import { CommandRegistryError, createCommandRegistry, type CommandRegistryDependencies } from './registry'

function stableError(code: string, message: string, requestId: string, retryable = false) {
  return { error: { code, message, requestId, retryable } }
}

function isCommandVersionAssertion(cause: unknown): cause is Error {
  return cause instanceof Error
    && (cause as Error & { code?: string }).code === '22P02'
    && cause.message.includes('COMMAND_VERSION_CONFLICT')
}

type RegistryFactory = (env: AuthedEnv['Bindings']) => CommandRegistryDependencies

export function createCommandsRoutes(factory?: RegistryFactory) {
  const routes = new Hono<AuthedEnv>()

  async function handle(c: Context<AuthedEnv>, execute: boolean) {
    const requestId = c.req.header('x-request-id') ?? crypto.randomUUID()
    const tenantId = c.req.header('x-workspace-id')
    if (!tenantId) return c.json(stableError('COMMAND_ENVELOPE_INVALID', 'Workspace header is required', requestId), 400)
    let raw: unknown
    try {
      raw = await c.req.json()
    } catch {
      return c.json(stableError('COMMAND_ENVELOPE_INVALID', 'Invalid JSON body', requestId), 400)
    }
    try {
      const request = execute
        ? parseCommandExecuteRequest(raw) as CommandExecuteRequest
        : parseCommandPreviewRequest(raw) as CommandRequest
      if (request.command !== c.req.param('command')) {
        return c.json(stableError('COMMAND_ENVELOPE_INVALID', 'Command path does not match envelope', requestId), 400)
      }
      const dependencies = factory
        ? factory(c.env)
        : commandRegistryDependencies(sqlFrom(c.env ?? {}))
      const registry = createCommandRegistry(dependencies)
      const context = { claims: c.get('claims'), tenantId, requestId }
      const result = execute
        ? await registry.execute(context, request as CommandExecuteRequest)
        : await registry.preview(context, request)
      return c.json(result)
    } catch (cause) {
      if (cause instanceof CommandRegistryError) {
        return c.json(stableError(cause.code, cause.message, requestId, cause.code === 'COMMAND_VERSION_CONFLICT'), cause.status)
      }
      if (cause instanceof Error && cause.message === 'COMMAND_ENVELOPE_INVALID') {
        return c.json(stableError('COMMAND_ENVELOPE_INVALID', 'Invalid command envelope', requestId), 400)
      }
      if (isCommandVersionAssertion(cause)) {
        return c.json(stableError('COMMAND_VERSION_CONFLICT', 'COMMAND_VERSION_CONFLICT', requestId, true), 409)
      }
      console.error('[commands] request failed', cause)
      return c.json(stableError('COMMAND_EXECUTION_FAILED', 'Command execution failed', requestId, true), 500)
    }
  }

  routes.post('/:command/preview', (c) => handle(c, false))
  routes.post('/:command/execute', (c) => handle(c, true))
  return routes
}

export const commandsRoutes = createCommandsRoutes()
