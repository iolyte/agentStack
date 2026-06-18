/**
 * Mission Control PostgreSQL pool.
 *
 * IMPORTANT: Mission Control no longer owns any PostgreSQL schemas.
 * - `mission_control` schema has been removed; all data is in `amp.*` managed by control-plane.
 * - This pool is kept only for BFF-level ops: persistence health inspection in /api/persistence.
 *   Control-plane owns all domain data writes.
 */
import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var missionControlPool: Pool | undefined
}

function getConnectionString() {
  const value = process.env.POSTGRES_URL?.trim()

  if (!value) {
    throw new Error('POSTGRES_URL is not configured')
  }

  return value
}

export function getPostgresPool() {
  if (!global.missionControlPool) {
    global.missionControlPool = new Pool({
      connectionString: getConnectionString(),
      max: 3,
      idleTimeoutMillis: 10_000,
    })
  }

  return global.missionControlPool
}
