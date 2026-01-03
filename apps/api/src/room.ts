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

  async fetch(request: Request): Promise<Response> {
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
    try {
      const data: Message = JSON.parse(message as string)

      switch (data.type) {
        case 'join':
          this.handleJoin(ws, data as Message & { name: string })
          break
        case 'stroke':
          this.handleStroke(ws, data as Message & { stroke: Stroke })
          break
        case 'stroke-update':
          this.handleStrokeUpdate(ws, data as Message & { strokeId: string; point: Point })
          break
        case 'clear':
          this.handleClear(ws)
          break
      }
    } catch (e) {
      console.error('WebSocket message error:', e)
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.handleLeave(ws)
  }

  async webSocketError(ws: WebSocket) {
    this.handleLeave(ws)
  }

  private handleJoin(ws: WebSocket, data: Message & { name: string }) {
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

  private handleStroke(ws: WebSocket, data: Message & { stroke: Stroke }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    const stroke: Stroke = {
      ...data.stroke,
      playerId,
    }

    this.strokes.push(stroke)

    this.broadcast(
      {
        type: 'stroke',
        stroke,
      },
      ws
    )
  }

  private handleStrokeUpdate(ws: WebSocket, data: Message & { strokeId: string; point: Point }) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

    const stroke = this.strokes.find((s) => s.id === data.strokeId && s.playerId === playerId)
    if (stroke) {
      stroke.points.push(data.point)

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

  private handleClear(ws: WebSocket) {
    const playerId = this.getPlayerIdForSocket(ws)
    if (!playerId) return

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
        } catch {
          // Connection closed
        }
      }
    }
  }
}
