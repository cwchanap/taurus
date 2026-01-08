import { DurableObject } from 'cloudflare:workers'

interface Player {
  id: string
  name: string
  color: string
}

interface Point {
  x: number
  y: number
}

interface Stroke {
  id: string
  playerId: string
  points: Point[]
  color: string
  size: number
}

interface Message {
  type: string
  [key: string]: unknown
}

interface WebSocketAttachment {
  playerId: string
  player: Player
}

const COLORS = [
  '#FF6B6B',
  '#4ECDC4',
  '#45B7D1',
  '#96CEB4',
  '#FFEAA7',
  '#DDA0DD',
  '#98D8C8',
  '#F7DC6F',
]

export class DrawingRoom extends DurableObject<CloudflareBindings> {
  private strokes: Stroke[] = []
  private initialized = false

  private async ensureInitialized() {
    if (!this.initialized) {
      this.strokes = (await this.ctx.storage.get<Stroke[]>('strokes')) || []
      this.initialized = true
    }
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureInitialized()
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      const upgradeHeader = request.headers.get('Upgrade')
      if (!upgradeHeader || upgradeHeader !== 'websocket') {
        return new Response('Expected WebSocket', { status: 426 })
      }

      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)

      this.ctx.acceptWebSocket(server)

      return new Response(null, { status: 101, webSocket: client })
    }

    if (url.pathname === '/info') {
      const players = this.getPlayers()
      return Response.json({
        playerCount: players.length,
        strokeCount: this.strokes.length,
      })
    }

    return new Response('Not found', { status: 404 })
  }

  private getPlayers(): Player[] {
    const players: Player[] = []
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
      if (attachment?.player) {
        players.push(attachment.player)
      }
    }
    return players
  }

  private getPlayerIdForSocket(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | null
    return attachment?.playerId ?? null
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    // Parse message - client error if this fails
    let data: Message
    try {
      let messageStr: string
      if (typeof message === 'string') {
        messageStr = message
      } else {
        messageStr = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(message)
      }
      data = JSON.parse(messageStr)
    } catch (e) {
      console.warn('Invalid message format from client:', e)
      return
    }

    // Handle message - server error if this fails
    try {
      switch (data.type) {
        case 'join':
          await this.handleJoin(ws, data as Message & { name: string })
          break
        case 'stroke':
          await this.handleStroke(ws, data as Message & { stroke: Stroke })
          break
        case 'stroke-update':
          await this.handleStrokeUpdate(ws, data as Message & { strokeId: string; point: Point })
          break
        case 'clear':
          await this.handleClear(ws)
          break
      }
    } catch (e) {
      console.error('Handler error for message type:', data.type, e)
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.handleLeave(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.handleLeave(ws)
  }

  private async handleJoin(ws: WebSocket, data: Message & { name: string }) {
    const playerId = crypto.randomUUID()
    const existingPlayers = this.getPlayers()
    const color = COLORS[existingPlayers.length % COLORS.length]

    const player: Player = {
      id: playerId,
      name: data.name || 'Anonymous',
      color,
    }

    // Store player info as WebSocket attachment
    const attachment: WebSocketAttachment = { playerId, player }
    ws.serializeAttachment(attachment)

    // Send current state to the new player (include existing players)
    await this.ensureInitialized()

    ws.send(
      JSON.stringify({
        type: 'init',
        playerId,
        player,
        players: [...existingPlayers, player],
        strokes: this.strokes,
      })
    )

    // Notify others about the new player
    this.broadcast(
      {
        type: 'player-joined',
        player,
      },
      ws
    )
  }

  private handleLeave(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (playerId) {
      this.broadcast({
        type: 'player-left',
        playerId,
      })
    }
  }

  private async handleStroke(ws: WebSocket, data: Message & { stroke: Stroke }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    await this.ensureInitialized()

    const stroke: Stroke = {
      ...data.stroke,
      playerId,
    }

    this.strokes.push(stroke)
    // Debounced or background save would be better, but let's at least keep memory in sync
    this.ctx.storage.put('strokes', this.strokes).catch((e) => console.error('Storage error:', e))

    this.broadcast(
      {
        type: 'stroke',
        stroke,
      },
      ws
    )
  }

  private async handleStrokeUpdate(
    ws: WebSocket,
    data: Message & { strokeId: string; point: Point }
  ) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    await this.ensureInitialized()

    const stroke = this.strokes.find((s) => s.id === data.strokeId && s.playerId === playerId)
    if (stroke) {
      stroke.points.push(data.point)

      // Update storage periodically or in background
      // For now, we broadcast immediately and save in background
      this.ctx.storage.put('strokes', this.strokes).catch((e) => console.error('Storage error:', e))

      this.broadcast(
        {
          type: 'stroke-update',
          strokeId: data.strokeId,
          point: data.point,
        },
        ws
      )
    }
  }

  private async handleClear(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    await this.ctx.storage.delete('strokes')
    this.strokes = []

    this.broadcast({
      type: 'clear',
    })
  }

  private broadcast(message: object, exclude?: WebSocket) {
    const data = JSON.stringify(message)
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== exclude) {
        try {
          ws.send(data)
        } catch (error) {
          // Only ignore InvalidStateError (connection closed between getting socket and sending)
          if (error instanceof DOMException && error.name === 'InvalidStateError') {
            continue
          }
          console.error('Unexpected broadcast error:', error)
        }
      }
    }
  }
}
