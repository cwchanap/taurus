import { Hono } from 'hono'
import { cors } from 'hono/cors'

export { DrawingRoom } from './room'

interface Env {
  DRAWING_ROOM: DurableObjectNamespace
}

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors())

app.get('/', (c) => {
  return c.text('Drawing Game API')
})

// Create a new room
app.post('/api/rooms', async (c) => {
  const roomId = crypto.randomUUID().slice(0, 8).toUpperCase()
  return c.json({ roomId })
})

// Get room info
app.get('/api/rooms/:id', async (c) => {
  const roomId = c.req.param('id')
  const id = c.env.DRAWING_ROOM.idFromName(roomId)
  const room = c.env.DRAWING_ROOM.get(id)

  const response = await room.fetch(new Request('http://internal/info'))
  const info = await response.json()

  return c.json({ roomId, ...info })
})

// WebSocket upgrade for room
app.get('/api/rooms/:id/ws', async (c) => {
  const roomId = c.req.param('id')
  const id = c.env.DRAWING_ROOM.idFromName(roomId)
  const room = c.env.DRAWING_ROOM.get(id)

  return room.fetch(
    new Request('http://internal/ws', {
      headers: c.req.raw.headers,
    })
  )
})

export default app
