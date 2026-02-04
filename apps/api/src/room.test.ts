import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

// Mock cloudflare:workers module
mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(state: unknown, env: unknown) {
      // @ts-expect-error - Mocking DurableObject constructor
      this.state = state
      // @ts-expect-error - Mocking DurableObject constructor
      this.env = env
    }
  },
}))

import type { DurableObjectState } from '@cloudflare/workers-types'
import { DrawingRoom } from './room'

describe('DrawingRoom - Player Leave During Game', () => {
  let room: DrawingRoom
  let mockState: Partial<DurableObjectState>

  let mockEnv: unknown

  beforeEach(() => {
    // Mock Durable Object state
    mockState = {
      storage: {
        get: mock(() => {}),
        put: mock(() => {}),
        delete: mock(() => {}),
        list: mock(() => {}),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      id: {
        toString: () => 'test-room-id',
        equals: () => false,
        name: 'test-room',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
      waitUntil: mock(() => {}),
      blockConcurrencyWhile: mock(async (fn) => await fn()),
    }

    mockEnv = {}

    // Suppress unused variable warnings for setup variables
    void mockEnv

    void room

    // Create actual DrawingRoom instance for future test implementation
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    room = new DrawingRoom(mockState as any, mockEnv as any)
  })

  afterEach(() => {
    // Bun test doesn't need explicit mock cleanup
  })

  test.skip('placeholder - setup verified', () => {
    // TODO: Implement actual setup verification
    expect(true).toBe(true)
  })

  test.skip('player who already drew leaves - adjusts drawerOrder and totalRounds', () => {
    // TODO: Implement using helper factory and DrawingRoom instance
    // This requires significant mocking of internal state which is hard to reach from outside
    expect(true).toBe(true)
  })
})
