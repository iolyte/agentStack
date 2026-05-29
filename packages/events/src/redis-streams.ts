import { createClient, type RedisClientType } from 'redis'
import type { WorkspaceEventEnvelope } from '../../domain/src/types'

type RunRequestEvent = {
  runId: string
  workspaceId: string
  projectId: string
  agentId: string
  sessionKey: string
}

declare global {
  // eslint-disable-next-line no-var
  var agentstackRedisClient: RedisClientType | undefined
  // eslint-disable-next-line no-var
  var agentstackRedisConnectPromise: Promise<RedisClientType> | undefined
}

const WORKSPACE_EVENTS_STREAM = 'agentstack:workspace-events'
const RUN_REQUESTS_STREAM = 'agentstack:run-requests'

function getRedisUrl() {
  return process.env.REDIS_URL?.trim() || 'redis://redis:6379'
}

async function getRedisClient() {
  if (global.agentstackRedisClient?.isOpen) {
    return global.agentstackRedisClient
  }

  if (!global.agentstackRedisConnectPromise) {
    global.agentstackRedisConnectPromise = (async () => {
      const client = createClient({
        url: getRedisUrl(),
      })

      client.on('error', () => {
        // Best-effort event publishing; callers handle failures.
      })

      await client.connect()
      global.agentstackRedisClient = client
      return client
    })()
  }

  return global.agentstackRedisConnectPromise
}

export async function publishWorkspaceEventEnvelope(event: WorkspaceEventEnvelope) {
  const client = await getRedisClient()

  await client.xAdd(WORKSPACE_EVENTS_STREAM, '*', {
    workspaceId: event.workspaceId,
    eventId: String(event.id),
    type: event.type,
    entityType: event.entityType,
    entityId: event.entityId ?? '',
    createdAt: event.createdAt,
    payload: JSON.stringify(event.payload ?? {}),
  })
}

export async function publishRunRequested(event: RunRequestEvent) {
  const client = await getRedisClient()

  await client.xAdd(RUN_REQUESTS_STREAM, '*', {
    runId: event.runId,
    workspaceId: event.workspaceId,
    projectId: event.projectId,
    agentId: event.agentId,
    sessionKey: event.sessionKey,
    requestedAt: new Date().toISOString(),
  })
}

export { RUN_REQUESTS_STREAM, WORKSPACE_EVENTS_STREAM }
