import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.{js,ts}'],
      exclude: ['e2e/**', 'node_modules/**'],
      coverage: {
        reporter: ['lcov', 'text'],
        exclude: ['node_modules/', 'e2e/', '**/*.test.ts', '**/*.spec.ts'],
      },
    },
  })
)
