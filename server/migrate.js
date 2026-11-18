import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from './db.js'

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), 'migrations')
const migrationNames = [
  '001_initial_schema.sql',
  '002_google_auth.sql',
  '003_booking_addons.sql',
  '004_full_booking_addon_catalog.sql',
  '005_booking_addon_images.sql',
  '006_confirmation_email.sql',
  '007_airbnb_listings.sql',
  '008_airbnb_host_name.sql',
  '009_checkout_drafts.sql',
  '010_system_messages.sql',
  '011_reservation_message_participants.sql',
  '012_user_profiles.sql',
  '013_scheduled_messages.sql',
  '014_scheduled_message_listings.sql',
  '015_scheduled_attachments.sql',
]

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  for (const migrationName of migrationNames) {
    const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [migrationName])
    if (rowCount) {
      console.log(`Migration ${migrationName} is already applied`)
      continue
    }

    const sql = await readFile(join(migrationsDirectory, migrationName), 'utf8')
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [migrationName])
      await client.query('COMMIT')
      console.log(`Applied migration ${migrationName}`)
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }
} catch (error) {
  console.error('Database migration failed:', error)
  process.exitCode = 1
} finally {
  await pool.end()
}
