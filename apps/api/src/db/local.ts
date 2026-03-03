import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { join } from 'path'

let localDB: ReturnType<typeof drizzle> | null = null

export function initializeLocalDB() {
  if (localDB) return localDB

  // Resolve paths relative to package root (apps/api/)
  // This ensures consistency with drizzle.config.dev.ts
  const dbPath = join(process.cwd(), 'dev.db')
  const sqlite = new Database(dbPath)

  localDB = drizzle(sqlite)

  // Run migrations
  const migrationsFolder = join(process.cwd(), 'drizzle')
  migrate(localDB, { migrationsFolder })

  return localDB
}

export function getLocalDB() {
  if (!localDB) {
    throw new Error('Local DB not initialized. Call initializeLocalDB() first.')
  }
  return localDB
}
