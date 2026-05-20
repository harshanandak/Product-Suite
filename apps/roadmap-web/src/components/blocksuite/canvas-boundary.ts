import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import {
  createCanvasBoundary,
  type CanvasBoundary,
  type CanvasIdentity,
  type CanvasRealtimeAdapter,
  type CanvasRealtimeConnection,
  type CanvasRealtimeHandlers,
  type CanvasRealtimePayload,
} from '@product-suite/ui-canvas'
import { createHocuspocusDocumentName } from '@product-suite/hocuspocus'
import { SHARED_CANVAS_DOCUMENT_TABLE } from '@/lib/supabase/shared-contracts'
import { loadYjsState, saveYjsState } from './storage-client'

export type RoadmapRealtimeSelectionConfig = Omit<RoadmapRealtimeAdapterOptions, 'supabase'>

export function resolveRoadmapRealtimeSelectionConfig(
  env: Record<string, string | undefined> = process.env
): RoadmapRealtimeSelectionConfig {
  return {
    hocuspocusUrl: env.NEXT_PUBLIC_HOCUSPOCUS_URL,
  }
}

export function createRoadmapCanvasBoundary(
  supabase: SupabaseClient,
  realtimeConfig: RoadmapRealtimeSelectionConfig = resolveRoadmapRealtimeSelectionConfig()
): CanvasBoundary {
  return createSupabaseCanvasBoundary(supabase, realtimeConfig)
}

export function createSupabaseCanvasBoundary(
  supabase: SupabaseClient,
  realtimeConfig: RoadmapRealtimeSelectionConfig = {}
): CanvasBoundary {
  return createCanvasBoundary({
    persistence: {
      saveState(identity, state) {
        return saveYjsState(supabase, identity.teamId, identity.documentId, state)
      },
      loadState(identity) {
        return loadYjsState(supabase, identity.teamId, identity.documentId)
      },
    },
    metadata: {
      async updateMetadata(identity, metadata) {
        const { data, error } = await supabase
          .from(SHARED_CANVAS_DOCUMENT_TABLE)
          .update({
            storage_size_bytes: metadata.sizeBytes,
            last_sync_at: new Date().toISOString(),
            sync_version: metadata.syncVersion,
            updated_at: new Date().toISOString(),
          })
          .eq('id', identity.documentId)
          .eq('team_id', identity.teamId)
          .select('id')

        if (error) {
          console.warn('[CanvasBoundary] Failed to update metadata:', error)
          return false
        }

        if (!data || data.length === 0) {
          console.warn('[CanvasBoundary] Metadata update matched 0 rows')
          return false
        }

        return true
      },
    },
    realtime: {
      connect(identity, handlers) {
        return selectRoadmapRealtimeAdapter({ supabase, ...realtimeConfig }).connect(identity, handlers)
      },
    },
  })
}

export interface HocuspocusRealtimeConnectionOptions {
  url: string
  documentName: string
  token: string
  handlers: CanvasRealtimeHandlers
}

export interface RoadmapRealtimeAdapterOptions {
  supabase: SupabaseClient
  hocuspocusUrl?: string
  createAuthToken?: (identity: CanvasIdentity) => string
  createHocuspocusConnection?: (options: HocuspocusRealtimeConnectionOptions) => CanvasRealtimeConnection
}

export function selectRoadmapRealtimeAdapter(options: RoadmapRealtimeAdapterOptions): CanvasRealtimeAdapter {
  const hocuspocusUrl = options.hocuspocusUrl?.trim()
  if (!hocuspocusUrl || !options.createAuthToken || !options.createHocuspocusConnection) {
    return {
      connect(identity, handlers) {
        return createSupabaseRealtimeConnection(options.supabase, identity, handlers)
      },
    }
  }

  const createAuthToken = options.createAuthToken
  const createHocuspocusConnection = options.createHocuspocusConnection

  return {
    connect(identity, handlers) {
      const token = createAuthToken(identity)
      if (typeof token !== 'string' || token.trim().length === 0) {
        throw new Error('Roadmap Hocuspocus auth token factory must return a non-empty token synchronously')
      }

      return createHocuspocusConnection({
        url: hocuspocusUrl,
        documentName: createHocuspocusDocumentName(identity),
        token,
        handlers,
      })
    },
  }
}

function createSupabaseRealtimeConnection(
  supabase: SupabaseClient,
  identity: CanvasIdentity,
  handlers: CanvasRealtimeHandlers
) {
  const documentName = createHocuspocusDocumentName(identity)
  let channel: RealtimeChannel | null = supabase
    .channel(documentName)
    .on('broadcast', { event: 'yjs-update' }, (message) => {
      handlers.onUpdate(message.payload)
    })
    .subscribe((status) => {
      handlers.onConnectionChange?.(status === 'SUBSCRIBED')
    })

  return {
    sendUpdate(payload: CanvasRealtimePayload) {
      channel?.send({
        type: 'broadcast',
        event: 'yjs-update',
        payload,
      })
    },
    destroy() {
      if (channel) {
        supabase.removeChannel(channel)
        channel = null
      }
    },
  }
}
