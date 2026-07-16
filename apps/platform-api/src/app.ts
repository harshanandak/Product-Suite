import { Hono } from 'hono'

import { clerkAuth, type AuthedEnv } from './middleware/clerk-auth'
import { agentChatRoutes } from './routes/agent-chat'
import { agentReflectionRoutes } from './routes/agent-reflection'
import { agentThreadsRoutes } from './routes/agent-threads'
import { checksRoutes } from './routes/checks'
import { dependenciesRoutes } from './routes/dependencies'
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

app.use('/api/*', clerkAuth())

// Keystone endpoint: echoes the verified caller identity. Proves the
// Clerk-token → verify → AuthClaims spine end-to-end.
app.get('/api/me', (c) => c.json({ claims: c.get('claims') }))

// Workboard: tenant-scoped reads backed by the real Neon schema.
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

// Memory Brain: the org-scoped decision/knowledge store (Decision Log + Topic views).
app.route('/api/memories', memoriesRoutes)

export default app
