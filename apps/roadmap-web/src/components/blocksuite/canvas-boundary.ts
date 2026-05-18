import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import {
  createCanvasBoundary,
  createCanvasStoragePath,
  type CanvasBoundary,
  type CanvasIdentity,
  type CanvasRealtimePayload,
} from '@product-suite/ui-canvas'
import { SHARED_CANVAS_DOCUMENT_TABLE } from '@/lib/supabase/shared-contracts'
import { loadYjsState, saveYjsState } from './storage-client'

export function createSupabaseCanvasBoundary(supabase: SupabaseClient): CanvasBoundary {
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
        return createSupabaseRealtimeConnection(supabase, identity, handlers)
      },
    },
  })
}

function createSupabaseRealtimeConnection(
  supabase: SupabaseClient,
  identity: CanvasIdentity,
  handlers: {
    onUpdate: (payload: unknown) => void
    onConnectionChange?: (connected: boolean) => void
  }
) {
  let channel: RealtimeChannel | null = supabase
    .channel(`blocksuite-${identity.documentId}`)
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
