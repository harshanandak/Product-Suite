import { Hono } from 'hono'

import { databaseReadiness } from './db'
import { clerkAuth, type AuthedEnv } from './middleware/clerk-auth'
import { agentChatRoutes } from './routes/agent-chat'
import { agentKbRoutes } from './routes/agent-kb'
import { agentMemoryImpactRoutes } from './routes/agent-memory-impact'
import { agentReflectionRoutes } from './routes/agent-reflection'
import { agentThreadsRoutes } from './routes/agent-threads'
import { checksRoutes } from './routes/checks'
import { conversationsRoutes } from './routes/conversations'
import { dependenciesRoutes } from './routes/dependencies'
import { meetingCandidatesRoutes } from './routes/meeting-candidates'
import { meetingIngestRoutes } from './routes/meeting-ingest'
import { memoriesRoutes } from './routes/memories'
import { ownersRoutes } from './routes/owners'
import { projectsRoutes } from './routes/projects'
import { proposalsRoutes } from './routes/proposals'
import { statusesRoutes } from './routes/statuses'
import { teamsRoutes } from './routes/teams'
import { workItemsRoutes } from './routes/work-items'

/**
 * The unified platform API behind the single Product-Suite surface. Every
 * `/api/*` route is authenticated once by the Clerk-verify middleware; handlers
 * authorize on the caller's canonical `AuthClaims` (`c.get('claims')`).
 */
const app = new Hono<AuthedEnv>()

app.get('/health', (c) => c.json({ ok: true }))

app.get('/health/ready', async (c) => {
  const readiness = await databaseReadiness(c.env ?? {})
  return c.json(readiness, readiness.ok ? 200 : 503)
})

app.use('/api/*', clerkAuth())

// Keystone endpoint: echoes the verified caller identity. Proves the
// Clerk-token → verify → AuthClaims spine end-to-end.
app.get('/api/me', (c) => c.json({ claims: c.get('claims') }))

// Workboard: tenant-scoped reads backed by the real Neon schema.
app.route('/api/conversations', conversationsRoutes)
app.route('/api/work-items', workItemsRoutes)
app.route('/api/checks', checksRoutes)
app.route('/api/dependencies', dependenciesRoutes)
app.route('/api/projects', projectsRoutes)
app.route('/api/teams', teamsRoutes)
app.route('/api/statuses', statusesRoutes)
app.route('/api/owners', ownersRoutes)

// Agent decision inbox: proposals reviewed + applied through the single write path.
app.route('/api/agent/proposals', proposalsRoutes)

// Agent chat: prompt → read the workboard → propose changes into the queue above.
app.route('/api/agent/chat', agentChatRoutes)

// Durable agent chat threads: org-scoped list + reconstructed history + archive.
app.route('/api/agent/threads', agentThreadsRoutes)

// Reflection: mine recurring human corrections into rule proposals (same review queue).
app.route('/api/agent/reflection', agentReflectionRoutes)

// KB ingestion: backfill memory embeddings + ingest completed work-items as chunks.
app.route('/api/agent/kb', agentKbRoutes)

// Meeting ingest: promoted meeting action items → proposals in the same review queue.
app.route('/api/agent/meeting-ingest', meetingIngestRoutes)

// Meeting triage read: those candidates plus their true promotion state.
app.route('/api/agent/meeting-candidates', meetingCandidatesRoutes)

// Memory-impact metric: does memory measurably reduce the human editing burden?
app.route('/api/agent/memory-impact', agentMemoryImpactRoutes)

// Memory Brain: the org-scoped decision/knowledge store (Decision Log + Topic views).
app.route('/api/memories', memoriesRoutes)

export default app
