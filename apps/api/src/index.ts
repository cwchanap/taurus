import { Hono } from 'hono'
import { cors } from 'hono/cors'

export { DrawingRoom } from './room'

interface Env {
  DRAWING_ROOM: DurableObjectNamespace
  CORS_ORIGINS?: string
  NODE_ENV?: string
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', async (c, next) => {
  const isDevelopment = c.env.NODE_ENV === 'development'

  // Allow permissive CORS ONLY in explicit development mode
  if (isDevelopment) {
    return cors()(c, next)
  }

  // In non-development, require explicit CORS configuration
  const allowedOrigins = (c.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0)

  // Default to restrictive if no origins configured
  if (allowedOrigins.length === 0) {
    const restrictiveCors = cors({
      origin: () => null,
    })
    return restrictiveCors(c, next)
  }

  const corsMiddleware = cors({
    origin: (origin) => {
      if (!origin) return null
      return allowedOrigins.includes(origin) || allowedOrigins.includes('*') ? origin : null
    },
  })

  return corsMiddleware(c, next)
})

app.get('/', (c) => {
  return c.text('Drawing Game API')
})

// Create a new room
app.post('/api/rooms', async (c) => {
  try {
    // Generate a 12-character alphanumeric ID (6 random bytes as hex)
    const array = new Uint8Array(6)
    crypto.getRandomValues(array)
    const roomId = Array.from(array)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()

    const id = c.env.DRAWING_ROOM.idFromName(roomId)
    const room = c.env.DRAWING_ROOM.get(id)
    await room.fetch(new Request('http://internal/create', { method: 'POST' }))
    return c.json({ roomId })
  } catch (e) {
    console.error('Error creating room:', e)
    return c.text('Internal Server Error', 500)
  }
})

// Get room info
app.get('/api/rooms/:id', async (c) => {
  try {
    const roomId = c.req.param('id')

    // Normalize to uppercase for consistency with room ID generation
    const normalizedId = roomId.toUpperCase()

    // Validate room ID format (12-char alphanumeric)
    if (!/^[A-Z0-9]{12}$/.test(normalizedId)) {
      return c.json({ error: 'Invalid room ID format' }, 400)
    }

    const id = c.env.DRAWING_ROOM.idFromName(normalizedId)
    const room = c.env.DRAWING_ROOM.get(id)

    const response = await room.fetch(new Request('http://internal/info'))

    if (!response.ok) {
      return c.json({ error: 'Room not found' }, 404)
    }

    const info = (await response.json()) as Record<string, unknown>

    return c.json({ roomId: normalizedId, ...info })
  } catch (error) {
    console.error('Failed to fetch room:', error)
    return c.json({ error: 'Failed to fetch room' }, 500)
  }
})

// WebSocket upgrade for room
app.get('/api/rooms/:id/ws', async (c) => {
  try {
    const roomId = c.req.param('id')

    // Normalize to uppercase for consistency with room ID generation
    const normalizedId = roomId.toUpperCase()

    // Validate roomId format (12-char alphanumeric)
    if (!/^[A-Z0-9]{12}$/.test(normalizedId)) {
      return c.text('Invalid Room ID', 400)
    }

    const id = c.env.DRAWING_ROOM.idFromName(normalizedId)

    const room = c.env.DRAWING_ROOM.get(id)

    // Whitelist safe headers
    const safeHeaders = [
      'sec-websocket-key',
      'sec-websocket-version',
      'sec-websocket-extensions',
      'sec-websocket-protocol',
      'origin',
      'host',
      'upgrade',
      'connection',
    ]
    const headers = new Headers()
    c.req.raw.headers.forEach((value, key) => {
      if (safeHeaders.includes(key.toLowerCase())) {
        headers.set(key, value)
      }
    })

    return await room.fetch(
      new Request('http://internal/ws', {
        headers: headers,
      })
    )
  } catch (e) {
    console.error('Error in room WS Upgrade:', e)
    return c.text('Internal Server Error', 500)
  }
})

export default app
