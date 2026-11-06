// Points tests at the dedicated `gameon_test` database.
//
// The URL is derived from .env.local (same credentials, database name swapped)
// so no new secrets file is needed. Integration tests TRUNCATE tables, so this
// refuses to run against anything that isn't named gameon_test.

import fs from 'node:fs'
import path from 'node:path'

function testDatabaseUrl(): string | null {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL
  const file = path.resolve(__dirname, '..', '.env.local')
  if (!fs.existsSync(file)) return null
  const line = fs.readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='))
  if (!line) return null
  const url = line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '')
  const u = new URL(url)
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname)) return null // never derive a test DB from a remote URL
  u.pathname = '/gameon_test'
  return u.toString()
}

const url = testDatabaseUrl()
if (url) {
  const name = new URL(url).pathname.replace(/^\//, '')
  if (name !== 'gameon_test') throw new Error(`Refusing to run tests against database "${name}"`)
  process.env.DATABASE_URL = url
} else {
  delete process.env.DATABASE_URL
}
process.env.TEST_DB_AVAILABLE = url ? '1' : ''
