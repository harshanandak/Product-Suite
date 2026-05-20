/**
 * BlockSuite Hybrid Provider
 * Phase 4: Supabase Persistence (Yjs + Real-time)
 *
 * Hybrid Yjs Provider combining:
 * - Supabase Realtime: Fast broadcasts for real-time collaboration
 * - Supabase Storage: Scalable persistence (S3 backend)
 * - PostgreSQL: Metadata only (permissions, team_id, sync_version)
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                        CLIENT                                    │
 * │  BlockSuite Editor ←→ Yjs Doc ←→ HybridProvider                 │
 * └─────────────────────────────────────────────────────────────────┘
 *                               │
 *            ┌──────────────────┼──────────────────┐
 *            ▼                  ▼                  ▼
 * ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
 * │ Supabase        │  │ Supabase        │  │ Supabase        │
 * │ Realtime        │  │ Storage         │  │ PostgreSQL      │
 * │ • Broadcasts    │  │ • Yjs binary    │  │ • Metadata      │
 * │ • Presence      │  │ • Snapshots     │  │ • Permissions   │
 * └─────────────────┘  └─────────────────┘  └─────────────────┘
 */

import * as Y from 'yjs'
import type {
  CanvasMetadataStore,
  CanvasPersistenceAdapter,
  CanvasRealtimeAdapter,
  CanvasRealtimeConnection,
  CanvasRealtimePayload,
} from '@product-suite/ui-canvas'
import {
  DEFAULT_DEBOUNCE_MS,
  isValidId,
  type HybridProviderOptions,
} from './persistence-types'
import { safeValidateYjsUpdatePayload } from './schema'

/**
 * Hybrid Yjs Provider for BlockSuite
 *
 * Handles real-time synchronization and persistent storage:
 * - Broadcasts updates immediately via Supabase Realtime
 * - Debounces saves to Supabase Storage (less frequent writes)
 * - Saves on beforeunload/visibilitychange for reliability
 */
export class HybridProvider {
  private doc: Y.Doc
  private documentId: string
  private teamId: string
  private persistence: CanvasPersistenceAdapter
  private realtime: CanvasRealtimeAdapter
  private metadata: CanvasMetadataStore
  private connection: CanvasRealtimeConnection | null = null
  private saveTimeout: ReturnType<typeof setTimeout> | null = null
  private debounceMs: number
  private syncVersion: number = 0
  private isDirty: boolean = false
  private destroyed: boolean = false
  private isLoaded: boolean = false
  private isSaving: boolean = false // Mutex lock to prevent concurrent saves
  private saveRequestedWhileSaving: boolean = false
  private changeVersion: number = 0
  private onConnectionChange?: (connected: boolean) => void
  private onSyncError?: (error: Error) => void

  constructor(doc: Y.Doc, options: HybridProviderOptions) {
    // SECURITY: Validate documentId and teamId format before use
    if (!isValidId(options.documentId)) {
      throw new Error(
        `[HybridProvider] Invalid documentId format: "${options.documentId}". ` +
          'Must be alphanumeric with hyphens/underscores only.'
      )
    }
    if (!isValidId(options.teamId)) {
      throw new Error(
        `[HybridProvider] Invalid teamId format: "${options.teamId}". ` +
          'Must be alphanumeric with hyphens/underscores only.'
      )
    }

    this.doc = doc
    this.documentId = options.documentId
    this.teamId = options.teamId
    this.persistence = options.persistence
    this.realtime = options.realtime
    this.metadata = options.metadata
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
    this.onConnectionChange = options.onConnectionChange
    this.onSyncError = options.onSyncError

    // Listen for local changes
    this.doc.on('update', this.handleUpdate)

    // Set up real-time channel for broadcasts
    this.setupRealtimeChannel()

    // Save on window events (browser only)
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('beforeunload', this.handleBeforeUnload)
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', this.handleVisibilityChange)
      }
    }
  }

  /**
   * Handle local Yjs updates
   * - Skip updates from remote (prevent loops)
   * - Broadcast immediately for real-time
   * - Debounce saves to storage
   */
  private handleUpdate = (update: Uint8Array, origin: unknown) => {
    // Skip if update came from remote (prevent loops)
    if (origin === 'remote') return

    this.isDirty = true
    this.changeVersion++

    // Broadcast immediately for real-time sync
    this.broadcast(update)

    // Debounce save to storage (less frequent)
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    this.saveTimeout = setTimeout(() => this.save(), this.debounceMs)
  }

  /**
   * Handle beforeunload event - save any pending changes
   */
  private handleBeforeUnload = () => {
    if (this.isDirty) {
      this.saveSync() // Synchronous save attempt
    }
  }

  /**
   * Handle visibility change - save when tab becomes hidden
   */
  private handleVisibilityChange = () => {
    if (document.hidden && this.isDirty) {
      this.save() // Save when tab becomes hidden
    }
  }

  /**
   * Save Yjs state to Supabase Storage
   * Uses mutex lock to prevent concurrent save operations
   */
  async save(): Promise<void> {
    if (this.destroyed || !this.isDirty) return

    // Mutex lock: Skip if already saving to prevent concurrent writes
    if (this.isSaving) {
      console.log('[HybridProvider] Save already in progress, skipping')
      this.saveRequestedWhileSaving = true
      return
    }

    this.isSaving = true
    const saveVersion = this.changeVersion
    try {
      const state = Y.encodeStateAsUpdate(this.doc)

      const result = await this.persistence.saveState(
        { teamId: this.teamId, documentId: this.documentId },
        state
      )

      if (result.success) {
        // Update metadata in PostgreSQL
        // Note: Only increment syncVersion and clear isDirty after metadata update succeeds
        // to prevent desynchronization between local and database sync versions
        const metadataSuccess = await this.metadata.updateMetadata(
          { teamId: this.teamId, documentId: this.documentId },
          {
            sizeBytes: result.size ?? state.length,
            syncVersion: this.syncVersion + 1,
          }
        )
        if (metadataSuccess) {
          this.syncVersion++
          if (this.changeVersion === saveVersion) {
            this.isDirty = false
          } else {
            this.saveRequestedWhileSaving = true
          }
        }
      } else {
        console.error('[HybridProvider] Failed to save:', result.error)
        this.onSyncError?.(new Error(result.error ?? 'Unknown save error'))
      }
    } catch (error) {
      console.error('[HybridProvider] Save error:', error)
      this.onSyncError?.(error instanceof Error ? error : new Error(String(error)))
    } finally {
      this.isSaving = false
      if (this.saveRequestedWhileSaving && this.isDirty && !this.destroyed) {
        this.saveRequestedWhileSaving = false
        await this.save()
      } else {
        this.saveRequestedWhileSaving = false
      }
    }
  }

  /**
   * Synchronous save for beforeunload (best effort)
   * Uses sendBeacon for reliable delivery during page unload
   */
  private saveSync(): void {
    if (!this.isDirty) return

    try {
      const state = Y.encodeStateAsUpdate(this.doc)

      // Use sendBeacon for reliable delivery during page unload
      // This sends to our API route which handles the storage save
      // Create a fresh ArrayBuffer copy for Blob compatibility (avoids SharedArrayBuffer type issue)
      const buffer = new ArrayBuffer(state.length)
      new Uint8Array(buffer).set(state)
      const blob = new Blob([buffer], { type: 'application/octet-stream' })

      navigator.sendBeacon(
        `/api/blocksuite/documents/${this.documentId}/state`,
        blob
      )
    } catch (error) {
      console.error('[HybridProvider] Sync save error:', error)
    }
  }

  /**
   * Convert Uint8Array to base64 string safely (handles large arrays)
   * Uses chunked processing to avoid spread operator argument limits (~65K)
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    // Process in 32KB chunks to stay well under the ~65K argument limit
    const CHUNK_SIZE = 0x8000
    let binaryString = ''

    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
      const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length))
      // Use apply with array to avoid spread operator limits
      binaryString += String.fromCharCode.apply(null, Array.from(chunk))
    }

    return btoa(binaryString)
  }

  /**
   * Broadcast update to other clients via Supabase Realtime
   */
  private broadcast(update: Uint8Array): void {
    if (!this.connection) return

    try {
      // Convert Uint8Array to base64 for transmission (chunked for large updates)
      const base64 = this.uint8ArrayToBase64(update)

      const payload: CanvasRealtimePayload = {
        update: base64,
        documentId: this.documentId,
        origin: 'local',
      }

      this.connection.sendUpdate(payload)
    } catch (error) {
      console.warn('[HybridProvider] Broadcast error:', error)
    }
  }

  /**
   * Set up Supabase Realtime channel for broadcasts
   * SECURITY: Channel name uses validated documentId (validated in constructor)
   */
  private setupRealtimeChannel(): void {
    this.connection = this.realtime.connect(
      { teamId: this.teamId, documentId: this.documentId },
      {
        onUpdate: (payloadCandidate) => {
          // SECURITY: Validate payload structure before processing
          const validation = safeValidateYjsUpdatePayload(payloadCandidate)
          if (!validation.success) {
            console.warn(
              '[HybridProvider] Invalid broadcast payload received:',
              validation.error.flatten()
            )
            return
          }

          const payload = validation.data

          // Skip if not for this document
          if (payload.documentId !== this.documentId) return

          // Skip our own broadcasts
          if (payload.origin === 'local') return

          // SECURITY: Validate base64 format before decoding
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(payload.update)) {
            console.warn('[HybridProvider] Invalid base64 format in broadcast')
            return
          }

          try {
            // Decode base64 to Uint8Array
            const binaryString = atob(payload.update)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }

            // Apply remote update with 'remote' origin to prevent re-broadcast
            Y.applyUpdate(this.doc, bytes, 'remote')
          } catch (error) {
            console.warn('[HybridProvider] Failed to apply remote update:', error)
          }
        },
        onConnectionChange: (connected) => {
          this.onConnectionChange?.(connected)
        },
        onSyncError: (error) => {
          this.onSyncError?.(error)
        },
      },
      { document: this.doc }
    )
  }

  /**
   * Load initial state from Supabase Storage
   */
  async load(): Promise<void> {
    if (this.isLoaded) return

    try {
      const state = await this.persistence.loadState({
        teamId: this.teamId,
        documentId: this.documentId,
      })

      if (state && state.length > 0) {
        // Apply loaded state with 'remote' origin
        Y.applyUpdate(this.doc, state, 'remote')
      }

      this.isLoaded = true
    } catch (error) {
      console.error('[HybridProvider] Load error:', error)
      this.onSyncError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * Force save (for manual save button)
   */
  async forceSave(): Promise<void> {
    this.isDirty = true
    await this.save()
  }

  /**
   * Check if there are unsaved changes
   */
  get hasUnsavedChanges(): boolean {
    return this.isDirty
  }

  /**
   * Get current sync version
   */
  get currentSyncVersion(): number {
    return this.syncVersion
  }

  /**
   * Check if initial load is complete
   */
  get loaded(): boolean {
    return this.isLoaded
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.destroyed = true

    // Save any pending changes
    if (this.isDirty) {
      this.saveSync()
    }

    // Clear timeout
    if (this.saveTimeout) clearTimeout(this.saveTimeout)

    // Remove realtime channel
    if (this.connection) {
      this.connection.destroy()
      this.connection = null
    }

    // Remove Yjs listener
    this.doc.off('update', this.handleUpdate)

    // Remove window event listeners (browser only)
    if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload)
      if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
        document.removeEventListener('visibilitychange', this.handleVisibilityChange)
      }
    }
  }
}
