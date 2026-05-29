import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureMissionControlSchema, type MissionControlMetadata } from '@/lib/postgres'
import { getQdrantCollections, getRedisMemoryInfo } from '@/lib/telemetry'
import type {
  PersistenceStatus,
  QdrantCollectionInfo,
  RedisMemoryInfo,
  ServiceHealth,
  StoreStatus,
} from '@/lib/types'

const CONTAINER_STACK_DATA_ROOT = process.env.STACK_DATA_ROOT?.trim() || '/stack-data'
const HOST_STACK_DATA_ROOT = process.env.HOST_STACK_DATA_ROOT?.trim() || '/Users/harshitpatel/agentStack/.data'
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
    return {
      exists: false,
      populated: false,
      fileCount: 0,
    }
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

  return {
    exists: true,
    populated: fileCount > 0,
    fileCount,
  }
}

function findServiceStatus(services: ServiceHealth[], name: string) {
  return services.find((service) => service.name === name)?.status ?? 'unknown'
}

function resolveMountedStatus(directory: DirectorySnapshot, serviceStatus: ServiceHealth['status']): StoreStatus {
  if (!directory.exists) {
    return 'down'
  }

  if (serviceStatus === 'down') {
    return 'down'
  }

  if (serviceStatus === 'degraded' || serviceStatus === 'unknown') {
    return 'warning'
  }

  return 'healthy'
}

function describeFreshness(populated: boolean, emptyMessage: string, readyMessage: string) {
  return populated ? readyMessage : emptyMessage
}

function makeMissionControlStatus(directory: DirectorySnapshot, metadata: MissionControlMetadata | null, error: string | null): PersistenceStatus {
  const status: StoreStatus = metadata
    ? directory.exists
      ? 'healthy'
      : 'warning'
    : 'down'

  return {
    id: 'missionControl',
    label: 'Mission Control',
    status,
    path: hostPath('postgres'),
    mounted: directory.exists,
    populated: Boolean(metadata),
    details: metadata
      ? `Schema mission_control is bootstrapped in PostgreSQL. Last boot ${new Date(metadata.lastBootedAt).toLocaleString()}.`
      : error || 'Mission Control schema is not available yet.',
    fileCount: directory.fileCount,
    schemaVersion: metadata?.schemaVersion,
    lastBootedAt: metadata?.lastBootedAt,
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

function makeRedisStatus(directory: DirectorySnapshot, services: ServiceHealth[], redis: RedisMemoryInfo | null): PersistenceStatus {
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

function makeQdrantStatus(directory: DirectorySnapshot, services: ServiceHealth[], collections: QdrantCollectionInfo[]): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'Qdrant')

  return {
    id: 'qdrant',
    label: 'Qdrant',
    status: resolveMountedStatus(directory, serviceStatus),
    path: hostPath('qdrant'),
    mounted: directory.exists,
    populated: collections.length > 0 || directory.populated,
    details: collections.length > 0
      ? `${collections.length} collection${collections.length === 1 ? '' : 's'} detected in the vector store.`
      : describeFreshness(
          directory.populated,
          'Bind mount is ready, but no vector collections exist yet.',
          `Filesystem is populated, but Qdrant has not reported any collections yet.`,
        ),
    fileCount: directory.fileCount,
    collectionCount: collections.length,
  }
}

function makeOpenClawStatus(directory: DirectorySnapshot, services: ServiceHealth[]): PersistenceStatus {
  const serviceStatus = findServiceStatus(services, 'OpenClaw')
  const detectedFiles = OPENCLAW_EXPECTED_FILES.filter((path) => existsSync(join(containerPath('openclaw', 'config'), path)))
  const hasAgentsDirectory = existsSync(containerPath('openclaw', 'config', 'agents'))
  const status = detectedFiles.length === OPENCLAW_EXPECTED_FILES.length && hasAgentsDirectory
    ? resolveMountedStatus(directory, serviceStatus)
    : 'warning'

  return {
    id: 'openclaw',
    label: 'OpenClaw',
    status,
    path: hostPath('openclaw', 'config'),
    mounted: directory.exists,
    populated: detectedFiles.length > 0 || hasAgentsDirectory,
    details: status === 'healthy'
      ? 'OpenClaw config, task state, and persisted agent directories are present on disk.'
      : 'OpenClaw has not fully materialized its persisted config or agent directories yet. Start the gateway and bootstrap the team to generate them.',
    fileCount: directory.fileCount,
    detectedFiles: hasAgentsDirectory ? [...detectedFiles, 'agents/'] : detectedFiles,
  }
}

export async function inspectPersistence(services: ServiceHealth[]) {
  const postgresDirectory = inspectDirectory(containerPath('postgres'))
  const redisDirectory = inspectDirectory(containerPath('redis'))
  const qdrantDirectory = inspectDirectory(containerPath('qdrant'))
  const openclawDirectory = inspectDirectory(containerPath('openclaw', 'config'))

  let metadata: MissionControlMetadata | null = null
  let missionControlError: string | null = null

  try {
    metadata = await ensureMissionControlSchema()
  } catch (error) {
    missionControlError = error instanceof Error ? error.message : String(error)
  }

  const [redis, qdrantCollections] = await Promise.all([
    process.env.REDIS_URL ? getRedisMemoryInfo(process.env.REDIS_URL) : Promise.resolve(null),
    process.env.QDRANT_URL ? getQdrantCollections(process.env.QDRANT_URL) : Promise.resolve([]),
  ])

  return [
    makeMissionControlStatus(postgresDirectory, metadata, missionControlError),
    makePostgresStatus(postgresDirectory, services),
    makeRedisStatus(redisDirectory, services, redis),
    makeQdrantStatus(qdrantDirectory, services, qdrantCollections),
    makeOpenClawStatus(openclawDirectory, services),
  ] satisfies PersistenceStatus[]
}
