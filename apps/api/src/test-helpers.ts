import { mock } from 'bun:test'

// Mock cloudflare:workers module for Durable Object tests
export function setupCloudflareMock() {
  mock.module('cloudflare:workers', () => ({
    DurableObject: class {
      constructor(state: unknown, env: unknown) {
        // @ts-expect-error - Mocking DurableObject constructor
        this.ctx = state
        // @ts-expect-error - Mocking DurableObject constructor
        this.env = env
      }
    },
  }))
}

// Helper to flush all pending promises reliably
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockWs(playerId: string, playerName = 'TestPlayer'): any {
  let attachment: { playerId: string; player: { id: string; name: string; color: string } } = {
    playerId,
    player: { id: playerId, name: playerName, color: '#FF6B6B' },
  }
  return {
    deserializeAttachment: () => attachment,
    serializeAttachment: mock((data: unknown) => {
      attachment = data as typeof attachment
    }),
    send: mock(() => {}),
    close: mock(() => {}),
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSentMessages(ws: ReturnType<typeof createMockWs>): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ws.send as ReturnType<typeof mock>).mock.calls.map((call: any[]) => {
    try {
      return JSON.parse(call[0] as string)
    } catch {
      return null
    }
  })
}
