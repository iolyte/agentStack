import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getPostgresPool } from '@/lib/postgres'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { listAgents, listSessions } from '@/lib/openclaw'
import { getDashboardPreferences } from '@/lib/preferences'
import { listMcTasks, summarizeMcTasks } from '@/lib/mc-tasks'
import {
  collectStackHealth,
  getQdrantCollections,
  getRedisMemoryInfo,
} from '@/lib/services'
import { logger } from '@/lib/logger'
import type {
  GatewaySnapshot,
  OverviewPayload,
  PersistenceStatus,
  QdrantCollectionInfo,
  RedisMemoryInfo,
  ServiceHealth,
  SetupIssue,
  StoreStatus,
} from '@/lib/types'

const CONTAINER_STACK_DATA_ROOT = process.env.STACK_DATA_ROOT?.trim() || '/stack-data'
const HOST_STACK_DATA_ROOT =
  process.env.HOST_STACK_DATA_ROOT?.trim() || '/Users/harshitpatel/agentStack/.data'
const OPENCLAW_EXPECTED_FILES = ['openclaw.json', 'tasks/runs.sqlite']

type DirectorySnapshot = {
  exists: boolean
  populated: boolean
  fileCount: number
}

function hostPath(...parts: string[]) {
  return join(HOST_STACK_DATA_ROOT, ...parts)
}

function containerPath(...parts: string[]) {
  return join(CONTAINER_STACK_DATA_ROOT, ...parts)
}

function inspectDirectory(path: string): DirectorySnapshot {
  if (!existsSync(path)) {
    return { exists: false, populated: false, fileCount: 0 }
  }

  const entries = readdirSync(path)
  let fileCount = 0

  for (const entry of entries) {
    const absolutePath = join(path, entry)

    try {
      const stat = statSync(absolutePath)
      fileCount += 1

      if (stat.isDirectory()) {
        fileCount += inspectDirectory(absolutePath).fileCount
      }
    } catch {
      fileCount += 1
    }
  }

  return { exists: true, populated: fileCount > 0, fileCount }
}

function findServiceStatus(services: ServiceHealth[], name: string) {
  return services.find((s) => s.name === name)?.status ?? 'unknown'
}

function resolveMountedStatus(
  directory: DirectorySnapshot,
  serviceStatus: ServiceHealth['status'],
): StoreStatus {
  if (!directory.exists) return 'down'
  if (serviceStatus === 'down') return 'down'
  if (serviceStatus === 'degraded' || serviceStatus === 'unknown') return 'warning'
  return 'healthy'
}

function describeFreshness(populated: boolean, emptyMessage: string, readyMessage: string) {
  return populated ? readyMessage : emptyMessage
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b))
}

async function getControlPlaneSchemaInfo(): Promise<{
  schemaVersion: string | null
  lastBootedAt: string | null
  error: string | null
}> {
  try {
    const pool = getPostgresPool()
    const result = await pool.query<{
      schema_version: string
      last_booted_at: string
    }>(`
      SELECT schema_version, last_booted_at
      FROM amp.metadata
      WHERE singleton = TRUE
    `)

    const row = result.rows[0]
    if (!row) return { schemaVersion: null, lastBootedAt: null, error: 'amp.metadata not found' }

    return {
      schemaVersion: row.schema_version,
      lastBootedAt: row.last_booted_at,
      error: null,
    }
  } catch (error) {
    return {
      schemaVersion: null,
      lastBootedAt: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function makeControlPlaneStatus(
  directory: DirectorySnapshot,
): Promise<PersistenceStatus> {
  const { schemaVersion, lastBootedAt, error } = await getControlPlaneSchemaInfo()
  const status: StoreStatus = schemaVersion
    ? directory.exists
      ? 'healthy'
      : 'warning'
    : 'down'

  return {
    id: 'missionControl',
    label: 'Control Plane',
    status,
    path: hostPath('postgres'),
    mounted: directory.exists,
    populated: Boolean(schemaVersion),
    details: schemaVersion
      ? `Schema amp is bootstrapped in PostgreSQL. Last boot ${new Date(lastBootedAt!).toLocaleString()}.`
      : error || 'Control plane schema is not available yet.',
    fileCount: directory.fileCount,
    schemaVersion: schemaVersion ?? undefined,
    lastBootedAt: lastBootedAt ?? undefined,
  }
}

function makePostgresStatus(directory: DirectorySnapshot, services: ServiceHealth[]): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'PostgreSQL')

  return {
    id: 'postgres',
    label: 'PostgreSQL',
    status: resolveMountedStatus(directory, serviceStatus),
    path: hostPath('postgres'),
    mounted: directory.exists,
    populated: directory.populated,
    details: describeFreshness(
      directory.populated,
      'Bind mount is ready but the PostgreSQL data directory is still empty.',
      `Bind mount is active with ${directory.fileCount} filesystem entries.`,
    ),
    fileCount: directory.fileCount,
  }
}

function makeRedisStatus(
  directory: DirectorySnapshot,
  services: ServiceHealth[],
  redis: RedisMemoryInfo | null,
): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'Redis')

  return {
    id: 'redis',
    label: 'Redis',
    status: resolveMountedStatus(directory, serviceStatus),
    path: hostPath('redis'),
    mounted: directory.exists,
    populated: Boolean(redis?.keyCount) || directory.populated,
    details: redis
      ? `Append-only persistence is enabled with ${redis.keyCount} keys and ${redis.usedMemoryHuman} in memory.`
      : describeFreshness(
          directory.populated,
          'Bind mount is ready, but Redis has not persisted any keys yet.',
          `Bind mount is active with ${directory.fileCount} filesystem entries.`,
        ),
    fileCount: directory.fileCount,
    keyCount: redis?.keyCount,
  }
}

function makeQdrantStatus(
  directory: DirectorySnapshot,
  services: ServiceHealth[],
  collections: QdrantCollectionInfo[],
): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'Qdrant')

  return {
    id: 'qdrant',
    label: 'Qdrant',
    status: resolveMountedStatus(directory, serviceStatus),
    path: hostPath('qdrant'),
    mounted: directory.exists,
    populated: collections.length > 0 || directory.populated,
    details:
      collections.length > 0
        ? `${collections.length} collection${collections.length === 1 ? '' : 's'} detected in the vector store.`
        : describeFreshness(
            directory.populated,
            'Bind mount is ready, but no vector collections exist yet.',
            'Filesystem is populated, but Qdrant has not reported any collections yet.',
          ),
    fileCount: directory.fileCount,
    collectionCount: collections.length,
  }
}

function makeOpenClawStatus(directory: DirectorySnapshot, services: ServiceHealth[]): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'OpenClaw')
  const detectedFiles = OPENCLAW_EXPECTED_FILES.filter((path) =>
    existsSync(join(containerPath('openclaw', 'config'), path)),
  )
  const hasAgentsDirectory = existsSync(containerPath('openclaw', 'config', 'agents'))
  const status =
    detectedFiles.length === OPENCLAW_EXPECTED_FILES.length && hasAgentsDirectory
      ? resolveMountedStatus(directory, serviceStatus)
      : 'warning'

  return {
    id: 'openclaw',
    label: 'OpenClaw',
    status,
    path: hostPath('openclaw', 'config'),
    mounted: directory.exists,
    populated: detectedFiles.length > 0 || hasAgentsDirectory,
    details:
      status === 'healthy'
        ? 'OpenClaw config, task state, and persisted agent directories are present on disk.'
        : 'OpenClaw has not fully materialized its persisted config or agent directories yet. Start the gateway and bootstrap the team to generate them.',
    fileCount: directory.fileCount,
    detectedFiles: hasAgentsDirectory ? [...detectedFiles, 'agents/'] : detectedFiles,
  }
}

async function inspectPersistence(services: ServiceHealth[]): Promise<PersistenceStatus[]> {
  const postgresDirectory = inspectDirectory(containerPath('postgres'))
  const redisDirectory = inspectDirectory(containerPath('redis'))
  const qdrantDirectory = inspectDirectory(containerPath('qdrant'))
  const openclawDirectory = inspectDirectory(containerPath('openclaw', 'config'))

  const [cpStatus, redis, qdrantCollections] = await Promise.all([
    makeControlPlaneStatus(postgresDirectory),
    process.env.REDIS_URL ? getRedisMemoryInfo(process.env.REDIS_URL) : Promise.resolve(null),
    process.env.QDRANT_URL
      ? getQdrantCollections(process.env.QDRANT_URL)
      : Promise.resolve([]),
  ])

  return [
    cpStatus,
    makePostgresStatus(postgresDirectory, services),
    makeRedisStatus(redisDirectory, services, redis),
    makeQdrantStatus(qdrantDirectory, services, qdrantCollections),
    makeOpenClawStatus(openclawDirectory, services),
  ] satisfies PersistenceStatus[]
}

async function resolveGatewaySnapshot(services: ServiceHealth[]): Promise<GatewaySnapshot> {
  const gatewayServiceHealthy = services.some(
    (s) => s.name === 'OpenClaw' && s.status === 'healthy',
  )
  const [agentsResult, sessionsResult] = await Promise.allSettled([listAgents(), listSessions()])

  if (agentsResult.status === 'rejected') {
    logger.warn('Unable to load agents from OpenClaw', {
      error:
        agentsResult.reason instanceof Error
          ? agentsResult.reason.message
          : String(agentsResult.reason),
    })
  }

  if (sessionsResult.status === 'rejected') {
    logger.warn('Unable to load sessions from OpenClaw', {
      error:
        sessionsResult.reason instanceof Error
          ? sessionsResult.reason.message
          : String(sessionsResult.reason),
    })
  }

  const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : []
  const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []

  return {
    connected: gatewayServiceHealthy,
    agentCount: agents.length,
    sessionCount: sessions.length,
    models: uniqueStrings(agents.map((a) => a.model)),
    agents,
    sessions,
  }
}

function buildSetupIssues(
  services: ServiceHealth[],
  persistence: PersistenceStatus[],
  gateway: GatewaySnapshot,
  openclawConfig: ReturnType<typeof getOpenClawConfigSummary>,
): SetupIssue[] {
  const issues: SetupIssue[] = []

  for (const service of services) {
    if (service.status === 'healthy') continue

    issues.push({
      id: `service-${service.name.toLowerCase()}`,
      severity: service.status === 'down' ? 'critical' : 'warning',
      title: `${service.name} is ${service.status}`,
      details: service.details || 'The service did not respond to the latest health probe.',
      action: 'Inspect `agentstack doctor` and the service logs for the failing container.',
    })
  }

  for (const store of persistence) {
    if (store.status === 'healthy' && store.mounted) {
      if (!store.populated && (store.id === 'redis' || store.id === 'qdrant')) {
        issues.push({
          id: `store-fresh-${store.id}`,
          severity: 'info',
          title: `${store.label} is empty`,
          details: store.details,
          action:
            store.id === 'redis'
              ? 'Expected on a fresh stack. Activity will create keys automatically.'
              : 'Expected until embeddings or semantic search write collections.',
        })
      }

      continue
    }

    issues.push({
      id: `store-${store.id}`,
      severity: store.status === 'down' ? 'critical' : 'warning',
      title: `${store.label} persistence needs attention`,
      details: store.details,
      action: 'Verify the bind mount exists under `.data` and re-run `agentstack doctor`.',
    })
  }

  if (!gateway.connected) {
    issues.push({
      id: 'gateway-connection',
      severity: 'warning',
      title: 'agentStack is not connected to the OpenClaw gateway',
      details: 'The dashboard is running, but live gateway data could not be confirmed.',
      action: 'Confirm the gateway password in `.env` and restart the stack.',
    })
  }

  if (!openclawConfig.exists) {
    issues.push({
      id: 'openclaw-config-missing',
      severity: 'warning',
      title: 'OpenClaw config file is missing',
      details: 'Control plane could not find the persisted OpenClaw config file on disk.',
      action:
        'Verify `.data/openclaw/config/openclaw.json` exists and restart the stack if needed.',
    })
  } else if (!openclawConfig.valid) {
    issues.push({
      id: 'openclaw-config-invalid',
      severity: 'warning',
      title: 'OpenClaw config file is not valid JSON',
      details: 'Control plane found the config file but could not parse it safely.',
      action:
        'Inspect the config file and run `openclaw config validate --json` inside the gateway container.',
    })
  }

  if (issues.length === 0) {
    issues.push({
      id: 'stack-ready',
      severity: 'info',
      title: 'Stack is ready',
      details: 'Core services are healthy and the persistence roots are mounted.',
      action: 'Use `agentstack doctor` whenever you want a deeper filesystem and datastore audit.',
    })
  }

  return issues
}

export async function getOverviewPayload(): Promise<OverviewPayload> {
  const services = await collectStackHealth()
  const [persistence, gateway, preferences] = await Promise.all([
    inspectPersistence(services),
    resolveGatewaySnapshot(services),
    getDashboardPreferences(),
  ])
  const openclawConfig = getOpenClawConfigSummary()
  const tasks = await listMcTasks(preferences.showCompletedTasks)

  return {
    generatedAt: new Date().toISOString(),
    services,
    persistence,
    gateway,
    openclawConfig,
    setupIssues: buildSetupIssues(services, persistence, gateway, openclawConfig),
    preferences,
    tasks: {
      summary: summarizeMcTasks(tasks),
      recent: tasks.slice(0, 8),
    },
    ui: {
      appearance: preferences.appearancePreference,
      density: preferences.densityPreference,
      refreshSeconds: preferences.refreshIntervalSeconds,
    },
  }
}
