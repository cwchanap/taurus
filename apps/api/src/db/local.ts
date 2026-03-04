import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { migrate } from 'drizzle-orm/bun-sqlite/migrator'
import { join } from 'path'

let localDB: ReturnType<typeof drizzle> | null = null

export function initializeLocalDB() {
  if (localDB) return localDB

  const dbPath = join(process.cwd(), 'dev.db')
  const migrationsFolder = join(process.cwd(), 'drizzle')

  let sqlite: Database
  try {
    sqlite = new Database(dbPath)
  } catch (e) {
    throw new Error(`Failed to open SQLite database at "${dbPath}": ${e}`)
  }

  const db = drizzle(sqlite)

  try {
    migrate(db, { migrationsFolder })
  } catch (e) {
    sqlite.close()
    throw new Error(`Failed to run migrations from "${migrationsFolder}": ${e}`)
  }

  localDB = db
  return localDB
}

export function getLocalDB() {
  if (!localDB) {
    throw new Error('Local DB not initialized. Call initializeLocalDB() first.')
  }
  return localDB
}
