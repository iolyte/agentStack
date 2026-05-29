import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var agentstackPostgresPool: Pool | undefined
}

function getConnectionString() {
  const value = process.env.POSTGRES_URL?.trim()

  if (!value) {
    throw new Error('POSTGRES_URL is not configured')
  }

  return value
}

export function getPostgresPool() {
  if (!global.agentstackPostgresPool) {
    global.agentstackPostgresPool = new Pool({
      connectionString: getConnectionString(),
      max: 10,
      idleTimeoutMillis: 10_000,
    })
  }

  return global.agentstackPostgresPool
}
