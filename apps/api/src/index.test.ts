import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import app from './index'

type RoomFetch = ReturnType<typeof mock<(request: Request) => Promise<Response>>>
type IdFromName = ReturnType<typeof mock<(name: string) => string>>
type GetRoom = ReturnType<typeof mock<(id: string) => { fetch: RoomFetch }>>

interface TestEnv {
  DRAWING_ROOM: {
    idFromName: IdFromName
    get: GetRoom
  }
  CORS_ORIGINS?: string
  NODE_ENV?: string
}

interface TestContext {
  env: TestEnv
  idFromName: IdFromName
  getRoom: GetRoom
  roomFetch: RoomFetch
}

function createContext(
  overrides: Partial<TestEnv> = {},
  roomHandler: (request: Request) => Promise<Response> = async () =>
    new Response(null, {
      status: 204,
    })
): TestContext {
  const roomFetch = mock(roomHandler)
  const idFromName = mock((name: string) => `do:${name}`)
  const getRoom = mock((id: string) => ({ fetch: roomFetch, id }))

  return {
    env: {
      DRAWING_ROOM: {
        idFromName,
        get: getRoom,
      },
      NODE_ENV: 'production',
      CORS_ORIGINS: '',
      ...overrides,
    },
    idFromName,
    getRoom,
    roomFetch,
  }
}

async function request(path: string, init: RequestInit = {}, env: TestEnv): Promise<Response> {
  return app.fetch(new Request(`http://example.com${path}`, init), env as never)
}

describe('api entrypoint', () => {
  let originalConsoleError: typeof console.error

  beforeEach(() => {
    originalConsoleError = console.error
    console.error = mock(() => {}) as unknown as typeof console.error
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  test('development mode uses permissive CORS', async () => {
    const { env } = createContext({ NODE_ENV: 'development' })

    const response = await request(
      '/',
      {
        headers: {
          Origin: 'https://dev.example',
        },
      },
      env
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  test('production mode only allows configured origins and defaults to restrictive CORS', async () => {
    const allowed = createContext({
      CORS_ORIGINS: 'https://allowed.example, https://other.example',
    })

    const allowedResponse = await request(
      '/',
      {
        headers: {
          Origin: 'https://allowed.example',
        },
      },
      allowed.env
    )
    expect(allowedResponse.headers.get('access-control-allow-origin')).toBe(
      'https://allowed.example'
    )

    const blockedResponse = await request(
      '/',
      {
        headers: {
          Origin: 'https://blocked.example',
        },
      },
      allowed.env
    )
    expect(blockedResponse.headers.get('access-control-allow-origin')).toBeNull()

    const restrictive = createContext({ CORS_ORIGINS: '' })
    const restrictiveResponse = await request(
      '/',
      {
        headers: {
          Origin: 'https://blocked.example',
        },
      },
      restrictive.env
    )
    expect(restrictiveResponse.headers.get('access-control-allow-origin')).toBeNull()
  })

  test('POST /api/rooms creates an uppercase room id and initializes the durable object', async () => {
    const { env, idFromName, getRoom, roomFetch } = createContext()

    const response = await request('/api/rooms', { method: 'POST' }, env)
    const body = (await response.json()) as { roomId: string }

    expect(response.status).toBe(200)
    expect(body.roomId).toMatch(/^[A-F0-9]{12}$/)
    expect(idFromName).toHaveBeenCalledWith(body.roomId)
    expect(getRoom).toHaveBeenCalledWith(`do:${body.roomId}`)
    expect(roomFetch).toHaveBeenCalledTimes(1)

    const createRequest = roomFetch.mock.calls[0]?.[0] as Request
    expect(createRequest.url).toBe('http://internal/create')
    expect(createRequest.method).toBe('POST')
  })

  test('POST /api/rooms returns 500 when room initialization fails', async () => {
    const { env } = createContext({}, async () => {
      throw new Error('boom')
    })

    const response = await request('/api/rooms', { method: 'POST' }, env)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
  })

  test('GET /api/rooms/:id normalizes ids, fetches info, and returns the merged payload', async () => {
    const { env, idFromName, getRoom, roomFetch } = createContext({}, async () =>
      Response.json({
        created: true,
        players: 2,
      })
    )

    const response = await request('/api/rooms/ab12cd34ef56', {}, env)
    const body = (await response.json()) as {
      roomId: string
      created: boolean
      players: number
    }

    expect(response.status).toBe(200)
    expect(body).toEqual({
      roomId: 'AB12CD34EF56',
      created: true,
      players: 2,
    })
    expect(idFromName).toHaveBeenCalledWith('AB12CD34EF56')
    expect(getRoom).toHaveBeenCalledWith('do:AB12CD34EF56')

    const infoRequest = roomFetch.mock.calls[0]?.[0] as Request
    expect(infoRequest.url).toBe('http://internal/info')
  })

  test('GET /api/rooms/:id rejects invalid room ids before calling the durable object', async () => {
    const { env, idFromName, getRoom } = createContext()

    const response = await request('/api/rooms/not-valid', {}, env)
    const body = (await response.json()) as { error: string }

    expect(response.status).toBe(400)
    expect(body).toEqual({ error: 'Invalid room ID format' })
    expect(idFromName).not.toHaveBeenCalled()
    expect(getRoom).not.toHaveBeenCalled()
  })

  test('GET /api/rooms/:id maps missing and failing durable object fetches to 404 and 500', async () => {
    const missing = createContext({}, async () => new Response(null, { status: 404 }))
    const missingResponse = await request('/api/rooms/AB12CD34EF56', {}, missing.env)
    const missingBody = (await missingResponse.json()) as { error: string }
    expect(missingResponse.status).toBe(404)
    expect(missingBody).toEqual({ error: 'Room not found' })

    const failing = createContext({}, async () => {
      throw new Error('info failed')
    })
    const failingResponse = await request('/api/rooms/AB12CD34EF56', {}, failing.env)
    const failingBody = (await failingResponse.json()) as { error: string }
    expect(failingResponse.status).toBe(500)
    expect(failingBody).toEqual({ error: 'Failed to fetch room' })
  })

  test('GET /api/rooms/:id/ws rejects invalid room ids', async () => {
    const { env, idFromName, getRoom } = createContext()

    const response = await request('/api/rooms/short/ws', {}, env)

    expect(response.status).toBe(400)
    expect(await response.text()).toBe('Invalid Room ID')
    expect(idFromName).not.toHaveBeenCalled()
    expect(getRoom).not.toHaveBeenCalled()
  })

  test('GET /api/rooms/:id/ws only forwards safe headers to the durable object', async () => {
    const { env, roomFetch } = createContext({}, async () => new Response('ok'))

    const response = await request(
      '/api/rooms/ab12cd34ef56/ws',
      {
        headers: {
          connection: 'Upgrade',
          host: 'example.com',
          origin: 'https://app.example',
          'sec-websocket-extensions': 'permessage-deflate',
          'sec-websocket-key': 'key-123',
          'sec-websocket-protocol': 'taurus-v1',
          'sec-websocket-version': '13',
          upgrade: 'websocket',
          'x-secret-header': 'should-not-forward',
        },
      },
      env
    )

    expect(response.status).toBe(200)

    const wsRequest = roomFetch.mock.calls[0]?.[0] as Request
    expect(wsRequest.url).toBe('http://internal/ws')
    expect(wsRequest.headers.get('origin')).toBe('https://app.example')
    expect(wsRequest.headers.get('sec-websocket-extensions')).toBe('permessage-deflate')
    expect(wsRequest.headers.get('sec-websocket-key')).toBe('key-123')
    expect(wsRequest.headers.get('sec-websocket-protocol')).toBe('taurus-v1')
    expect(wsRequest.headers.get('sec-websocket-version')).toBe('13')
    expect(wsRequest.headers.get('connection')).toBe('Upgrade')
    expect(wsRequest.headers.get('upgrade')).toBe('websocket')
    expect(wsRequest.headers.get('host')).toBe('example.com')
    expect(wsRequest.headers.get('x-secret-header')).toBeNull()
  })

  test('GET /api/rooms/:id/ws returns 500 when the durable object upgrade fails', async () => {
    const { env } = createContext({}, async () => {
      throw new Error('ws failed')
    })

    const response = await request('/api/rooms/AB12CD34EF56/ws', {}, env)

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('Internal Server Error')
  })
})
