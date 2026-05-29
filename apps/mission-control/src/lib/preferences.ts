import { ensureMissionControlSchema, getPostgresPool } from '@/lib/postgres'
import type { AppearancePreference, DashboardPreferences, DensityPreference } from '@/lib/types'

const DEFAULT_PREFERENCES: DashboardPreferences = {
  appearancePreference: 'system',
  densityPreference: 'comfortable',
  showCompletedTasks: false,
  refreshIntervalSeconds: 15,
}

type PreferenceRow = {
  appearance_preference: AppearancePreference
  density_preference: DensityPreference
  show_completed_tasks: boolean
  refresh_interval_seconds: number
}

function normalizeAppearance(value: unknown): AppearancePreference {
  if (value === 'light' || value === 'dark') {
    return value
  }

  return 'system'
}

function normalizeDensity(value: unknown): DensityPreference {
  if (value === 'compact') {
    return value
  }

  return 'comfortable'
}

function normalizeRefreshInterval(value: unknown) {
  if (value === 30 || value === 60) {
    return value
  }

  return 15
}

function mapRow(row?: PreferenceRow | null): DashboardPreferences {
  if (!row) {
    return DEFAULT_PREFERENCES
  }

  return {
    appearancePreference: normalizeAppearance(row.appearance_preference),
    densityPreference: normalizeDensity(row.density_preference),
    showCompletedTasks: row.show_completed_tasks,
    refreshIntervalSeconds: normalizeRefreshInterval(row.refresh_interval_seconds),
  }
}

export function getDefaultDashboardPreferences() {
  return DEFAULT_PREFERENCES
}

export async function getDashboardPreferences() {
  await ensureMissionControlSchema()
  const pool = getPostgresPool()
  const result = await pool.query<PreferenceRow>(`
    SELECT
      appearance_preference,
      density_preference,
      show_completed_tasks,
      refresh_interval_seconds
    FROM mission_control.preferences
    WHERE singleton = TRUE
  `)

  return mapRow(result.rows[0] ?? null)
}

export async function updateDashboardPreferences(nextPreferences: Partial<DashboardPreferences>) {
  await ensureMissionControlSchema()
  const current = await getDashboardPreferences()
  const merged: DashboardPreferences = {
    appearancePreference: normalizeAppearance(nextPreferences.appearancePreference ?? current.appearancePreference),
    densityPreference: normalizeDensity(nextPreferences.densityPreference ?? current.densityPreference),
    showCompletedTasks: nextPreferences.showCompletedTasks ?? current.showCompletedTasks,
    refreshIntervalSeconds: normalizeRefreshInterval(nextPreferences.refreshIntervalSeconds ?? current.refreshIntervalSeconds),
  }

  const pool = getPostgresPool()
  await pool.query(
    `
      INSERT INTO mission_control.preferences (
        singleton,
        appearance_preference,
        density_preference,
        show_completed_tasks,
        refresh_interval_seconds
      )
      VALUES (TRUE, $1, $2, $3, $4)
      ON CONFLICT (singleton)
      DO UPDATE SET
        appearance_preference = EXCLUDED.appearance_preference,
        density_preference = EXCLUDED.density_preference,
        show_completed_tasks = EXCLUDED.show_completed_tasks,
        refresh_interval_seconds = EXCLUDED.refresh_interval_seconds
    `,
    [
      merged.appearancePreference,
      merged.densityPreference,
      merged.showCompletedTasks,
      merged.refreshIntervalSeconds,
    ],
  )

  return merged
}
