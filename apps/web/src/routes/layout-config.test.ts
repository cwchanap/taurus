import { describe, expect, it } from 'vitest'
import { prerender, ssr } from './+layout'

describe('+layout route config', () => {
  it('disables ssr and prerender', () => {
    expect(ssr).toBe(false)
    expect(prerender).toBe(false)
  })
})
