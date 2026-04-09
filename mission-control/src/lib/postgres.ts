import { Pool } from 'pg'
import { logger } from '@/lib/logger'

const SCHEMA_VERSION = '1'
const DEFAULT_BUILD_VERSION = 'phase1'

export type MissionControlMetadata = {
  schemaVersion: string
  buildVersion: string
  lastBootedAt: string
}

declare global {
  // eslint-disable-next-line no-var
  var missionControlPool: Pool | undefined
  // eslint-disable-next-line no-var
  var missionControlBootstrapPromise: Promise<MissionControlMetadata> | undefined
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
      max: 5,
      idleTimeoutMillis: 10_000,
    })
  }

  return global.missionControlPool
}

export async function ensureMissionControlSchema() {
  if (!global.missionControlBootstrapPromise) {
    global.missionControlBootstrapPromise = bootstrapMissionControlSchema()
  }

  return global.missionControlBootstrapPromise
}

async function bootstrapMissionControlSchema(): Promise<MissionControlMetadata> {
  const buildVersion = process.env.MISSION_CONTROL_BUILD?.trim() || DEFAULT_BUILD_VERSION
  const pool = getPostgresPool()

  await pool.query('CREATE SCHEMA IF NOT EXISTS mission_control')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mission_control.metadata (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      schema_version TEXT NOT NULL,
      build_version TEXT NOT NULL,
      last_booted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(
    `
      INSERT INTO mission_control.metadata (singleton, schema_version, build_version, last_booted_at)
      VALUES (TRUE, $1, $2, NOW())
      ON CONFLICT (singleton)
      DO UPDATE SET
        schema_version = EXCLUDED.schema_version,
        build_version = EXCLUDED.build_version,
        last_booted_at = EXCLUDED.last_booted_at
    `,
    [SCHEMA_VERSION, buildVersion],
  )

  const result = await pool.query<{
    schema_version: string
    build_version: string
    last_booted_at: string
  }>(`
    SELECT schema_version, build_version, last_booted_at
    FROM mission_control.metadata
    WHERE singleton = TRUE
  `)

  const row = result.rows[0]

  if (!row) {
    throw new Error('Mission Control metadata row was not created')
  }

  logger.info('Mission Control schema bootstrapped', {
    schemaVersion: row.schema_version,
    buildVersion: row.build_version,
  })

  return {
    schemaVersion: row.schema_version,
    buildVersion: row.build_version,
    lastBootedAt: row.last_booted_at,
  }
}

export async function hasMissionControlSchema() {
  const pool = getPostgresPool()
  const result = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'mission_control'
        AND table_name = 'metadata'
    ) AS exists
  `)

  return Boolean(result.rows[0]?.exists)
}
