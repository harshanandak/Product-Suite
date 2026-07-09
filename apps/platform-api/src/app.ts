import { Hono } from 'hono'

import { clerkAuth, type AuthedEnv } from './middleware/clerk-auth'

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

export default app
