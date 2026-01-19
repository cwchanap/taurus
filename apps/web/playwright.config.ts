import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  webServer: [
    {
      command: 'cd ../api && bun run dev',
      port: 8787,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'bun run build && bun run preview',
      port: 4173,
      reuseExistingServer: !process.env.CI,
    },
  ],
  testDir: 'e2e',
  testMatch: /(.+\.)?(test|spec)\.[jt]s/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  timeout: 120 * 1000,
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process',
            '--enable-unsafe-swiftshader',
            '--use-gl=swiftshader',
          ],
        },
      },
    },
  ],
})
