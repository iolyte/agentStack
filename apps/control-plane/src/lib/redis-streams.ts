import { createClient } from 'redis'
import type { WorkspaceEventEnvelope } from '@/lib/types'

type RunRequestEvent = {
  runId: string
  workspaceId: string
  projectId: string
  agentId: string
  sessionKey: string
}

declare global {
  // eslint-disable-next-line no-var
  var controlPlaneRedisClient: ReturnType<typeof createClient> | undefined
  // eslint-disable-next-line no-var
  var controlPlaneRedisConnectPromise: Promise<ReturnType<typeof createClient>> | undefined
}

export const WORKSPACE_EVENTS_STREAM = 'agentstack:workspace-events'
export const RUN_REQUESTS_STREAM = 'agentstack:run-requests'

function getRedisUrl() {
  return process.env.REDIS_URL?.trim() || 'redis://redis:6379'
}

async function getRedisClient() {
  if (global.controlPlaneRedisClient?.isOpen) {
    return global.controlPlaneRedisClient
  }

  if (!global.controlPlaneRedisConnectPromise) {
    global.controlPlaneRedisConnectPromise = (async () => {
      const client = createClient({ url: getRedisUrl() })
      client.on('error', () => {})
      await client.connect()
      global.controlPlaneRedisClient = client
      return client
    })()
  }

  return global.controlPlaneRedisConnectPromise
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
