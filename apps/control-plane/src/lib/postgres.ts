import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var clawstackPostgresPool: Pool | undefined
}

function getConnectionString() {
  const value = process.env.POSTGRES_URL?.trim()

  if (!value) {
    throw new Error('POSTGRES_URL is not configured')
  }

  return value
}

export function getPostgresPool() {
  if (!global.clawstackPostgresPool) {
    global.clawstackPostgresPool = new Pool({
      connectionString: getConnectionString(),
      max: 10,
      idleTimeoutMillis: 10_000,
    })
  }

  return global.clawstackPostgresPool
}
