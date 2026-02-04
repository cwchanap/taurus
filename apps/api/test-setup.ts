import { mock } from 'bun:test'

// Mock cloudflare:workers module which is virtual in Wrangler but missing in Bun
mock.module('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(state: unknown, env: unknown) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Mocking DurableObject for tests
      this.state = state
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore - Mocking DurableObject for tests
      this.env = env
    }
  },
}))
