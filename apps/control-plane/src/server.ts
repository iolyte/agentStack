import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { URL } from 'node:url'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { logger } from '@/lib/logger'
import { listAgents, listSessions } from '@/lib/openclaw'
import { subscribeToWorkspaceEvents } from '@/lib/workspace-events'
import {
  bootstrapWorkspaceForUser,
  createWorkspaceAgentForUser,
  createWorkspaceTaskForUser,
  deleteWorkspaceAgentForUser,
  ensureAmpSchema,
  ensureLocalOperatorUser,
  getWorkspaceSnapshotForUser,
  listMessagesForAgentForUser,
  listWorkspaceEventsForUser,
  sendMessageToAgentForUser,
  updateWorkspaceAgentForUser,
  updateWorkspaceTaskForUser,
  upsertGitHubUser,
} from '@/lib/workspace'
import type {
  AuthenticatedUser,
  Department,
  TaskPriority,
  TaskStatus,
  WorkspaceEventEnvelope,
  WorkspaceTask,
} from '@/lib/types'

const PORT = Number.parseInt(process.env.PORT?.trim() || '4100', 10)
const INTERNAL_TOKEN = process.env.AGENTSTACK_INTERNAL_TOKEN?.trim()
  || process.env.MC_SESSION_SECRET?.trim()
  || 'agentstack-internal'

function summarizeTasks(tasks: WorkspaceTask[]) {
  return tasks.reduce(
    (summary, task) => {
      summary.total += 1

      if (task.status === 'done') {
        summary.done += 1
      } else {
        summary.open += 1
      }

      if (task.status === 'in_progress') {
        summary.inProgress += 1
      }

      if (task.status === 'blocked') {
        summary.blocked += 1
      }

      if (task.priority === 'high' && task.status !== 'done') {
        summary.highPriorityOpen += 1
      }

      return summary
    },
    {
      total: 0,
      open: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
      highPriorityOpen: 0,
    },
  )
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function getInternalToken(request: IncomingMessage) {
  const value = request.headers['x-agentstack-internal-token']
  return Array.isArray(value) ? value[0] : value
}

function getSession(request: IncomingMessage): AuthenticatedUser | null {
  if (getInternalToken(request) !== INTERNAL_TOKEN) {
    return null
  }

  const rawHeader = request.headers['x-agentstack-user']
  const encoded = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader

  if (!encoded) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthenticatedUser
  } catch {
    return null
  }
}

async function readJson<T>(request: IncomingMessage) {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {} as T
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
}

function encodeSseChunk(input: { event: string; data: unknown; id?: number }) {
  const lines = []

  if (typeof input.id === 'number') {
    lines.push(`id: ${input.id}`)
  }

  lines.push(`event: ${input.event}`)
  lines.push(`data: ${JSON.stringify(input.data)}`)

  return `${lines.join('\n')}\n\n`
}

async function normalizeLocalSession(session: AuthenticatedUser) {
  if (session.authMode === 'local') {
    await ensureLocalOperatorUser()
  }

  return session
}

async function handleEvents(request: IncomingMessage, response: ServerResponse, session: AuthenticatedUser, url: URL) {
  const normalizedSession = await normalizeLocalSession(session)
  const snapshot = await getWorkspaceSnapshotForUser(normalizedSession)

  if (!snapshot.workspace) {
    sendJson(response, 409, { ok: false, error: 'Workspace setup has not been completed yet' })
    return
  }

  const rawAfterId = request.headers['last-event-id'] || url.searchParams.get('lastEventId')
  const afterIdValue = Array.isArray(rawAfterId) ? rawAfterId[0] : rawAfterId
  const afterId = afterIdValue ? Number.parseInt(String(afterIdValue), 10) : undefined
  const backlog = await listWorkspaceEventsForUser(normalizedSession, Number.isFinite(afterId) ? afterId : undefined)

  response.writeHead(200, {
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Content-Type': 'text/event-stream; charset=utf-8',
  })

  response.write(
    encodeSseChunk({
      event: 'connected',
      data: {
        workspaceId: snapshot.workspace.id,
        serverTime: new Date().toISOString(),
      },
    }),
  )

  for (const event of backlog) {
    response.write(encodeSseChunk({ event: 'workspace-event', data: event, id: event.id }))
  }

  const keepAlive = setInterval(() => {
    response.write(': keepalive\n\n')
  }, 15_000)

  const unsubscribe = subscribeToWorkspaceEvents(snapshot.workspace.id, (event: WorkspaceEventEnvelope) => {
    response.write(encodeSseChunk({ event: 'workspace-event', data: event, id: event.id }))
  })

  request.on('close', () => {
    clearInterval(keepAlive)
    unsubscribe()
    response.end()
  })
}

async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'control-plane'}`)

  if (url.pathname === '/health') {
    await ensureAmpSchema()
    sendJson(response, 200, { ok: true, service: 'control-plane' })
    return
  }

  if (url.pathname === '/auth/local' && request.method === 'POST') {
    if (getInternalToken(request) !== INTERNAL_TOKEN) {
      sendJson(response, 401, { ok: false, error: 'Unauthorized' })
      return
    }

    const user = await ensureLocalOperatorUser()
    sendJson(response, 200, { ok: true, user })
    return
  }

  if (url.pathname === '/auth/github-user' && request.method === 'POST') {
    if (getInternalToken(request) !== INTERNAL_TOKEN) {
      sendJson(response, 401, { ok: false, error: 'Unauthorized' })
      return
    }

    const body = await readJson<{
      githubId?: string
      login?: string
      name?: string
      email?: string | null
      avatarUrl?: string | null
    }>(request)

    if (!body.githubId?.trim() || !body.login?.trim()) {
      sendJson(response, 400, { ok: false, error: 'githubId and login are required' })
      return
    }

    const user = await upsertGitHubUser({
      githubId: body.githubId.trim(),
      login: body.login.trim(),
      name: body.name?.trim() || body.login.trim(),
      email: body.email ?? null,
      avatarUrl: body.avatarUrl ?? null,
    })
    sendJson(response, 200, { ok: true, user })
    return
  }

  const session = getSession(request)

  if (!session) {
    sendJson(response, 401, { ok: false, error: 'Unauthorized' })
    return
  }

  try {
    if (url.pathname === '/workspace' && request.method === 'GET') {
      const agentId = url.searchParams.get('agentId')?.trim() || undefined
      const snapshot = await getWorkspaceSnapshotForUser(await normalizeLocalSession(session), { agentId })
      sendJson(response, 200, { ok: true, ...snapshot })
      return
    }

    if (url.pathname === '/setup' && request.method === 'POST') {
      const body = await readJson<{ goal?: string; departments?: Department[] }>(request)
      const snapshot = await bootstrapWorkspaceForUser(await normalizeLocalSession(session), {
        goal: body.goal?.trim() || '',
        departments: Array.isArray(body.departments) ? body.departments : [],
      })
      sendJson(response, 200, { ok: true, ...snapshot })
      return
    }

    if (url.pathname === '/agents' && request.method === 'GET') {
      const normalizedSession = await normalizeLocalSession(session)
      const [snapshot, liveAgents] = await Promise.all([
        getWorkspaceSnapshotForUser(normalizedSession),
        listAgents().catch(() => []),
      ])
      const config = getOpenClawConfigSummary()
      sendJson(response, 200, {
        ok: true,
        agents: snapshot.agents,
        liveAgents,
        configuredAgents: config.configuredAgents,
      })
      return
    }

    if (url.pathname === '/agents' && request.method === 'POST') {
      const body = await readJson<{ projectId?: string; department?: Department; name?: string; role?: string }>(request)
      const snapshot = await createWorkspaceAgentForUser(await normalizeLocalSession(session), {
        projectId: body.projectId?.trim() || '',
        department: body.department || 'builder',
        name: body.name?.trim() || '',
        role: body.role?.trim() || '',
      })
      sendJson(response, 200, { ok: true, agents: snapshot.agents })
      return
    }

    if (url.pathname === '/agents' && request.method === 'PATCH') {
      const body = await readJson<{ agentId?: string; name?: string; role?: string }>(request)

      if (!body.agentId?.trim()) {
        sendJson(response, 400, { ok: false, error: 'agentId is required' })
        return
      }

      const snapshot = await updateWorkspaceAgentForUser(await normalizeLocalSession(session), {
        agentId: body.agentId.trim(),
        name: body.name,
        role: body.role,
      })
      sendJson(response, 200, { ok: true, agents: snapshot.agents })
      return
    }

    if (url.pathname === '/agents' && request.method === 'DELETE') {
      const agentId = url.searchParams.get('agentId')?.trim()

      if (!agentId) {
        sendJson(response, 400, { ok: false, error: 'agentId is required' })
        return
      }

      const snapshot = await deleteWorkspaceAgentForUser(await normalizeLocalSession(session), agentId)
      sendJson(response, 200, { ok: true, agents: snapshot.agents })
      return
    }

    if (url.pathname === '/tasks' && request.method === 'GET') {
      const snapshot = await getWorkspaceSnapshotForUser(await normalizeLocalSession(session))
      sendJson(response, 200, { ok: true, tasks: snapshot.tasks, summary: summarizeTasks(snapshot.tasks) })
      return
    }

    if (url.pathname === '/tasks' && request.method === 'POST') {
      const body = await readJson<{
        title?: string
        description?: string | null
        priority?: TaskPriority
        assignedAgentId?: string | null
      }>(request)
      const snapshot = await createWorkspaceTaskForUser(await normalizeLocalSession(session), {
        title: body.title ?? '',
        description: body.description,
        priority: body.priority,
        assignedAgentId: body.assignedAgentId ?? null,
      })
      sendJson(response, 200, { ok: true, tasks: snapshot.tasks, summary: summarizeTasks(snapshot.tasks) })
      return
    }

    if (url.pathname === '/tasks' && request.method === 'PATCH') {
      const body = await readJson<{
        id?: string
        status?: TaskStatus
        priority?: TaskPriority
        assignedAgentId?: string | null
      }>(request)

      if (!body.id?.trim()) {
        sendJson(response, 400, { ok: false, error: 'Task id is required' })
        return
      }

      const snapshot = await updateWorkspaceTaskForUser(await normalizeLocalSession(session), {
        id: body.id.trim(),
        status: body.status,
        priority: body.priority,
        assignedAgentId: body.assignedAgentId ?? null,
      })
      sendJson(response, 200, { ok: true, tasks: snapshot.tasks, summary: summarizeTasks(snapshot.tasks) })
      return
    }

    if (url.pathname === '/messages' && request.method === 'GET') {
      const agentId = url.searchParams.get('agentId')?.trim()

      if (!agentId) {
        sendJson(response, 400, { ok: false, error: 'agentId is required' })
        return
      }

      const messages = await listMessagesForAgentForUser(await normalizeLocalSession(session), agentId)
      sendJson(response, 200, { ok: true, messages })
      return
    }

    if ((url.pathname === '/messages' || url.pathname === '/chat') && request.method === 'POST') {
      const body = await readJson<{ agentId?: string; content?: string }>(request)

      if (!body.agentId?.trim()) {
        sendJson(response, 400, { ok: false, error: 'agentId is required' })
        return
      }

      const messages = await sendMessageToAgentForUser(await normalizeLocalSession(session), {
        agentId: body.agentId.trim(),
        content: body.content?.trim() || '',
      })
      sendJson(response, 200, { ok: true, messages })
      return
    }

    if (url.pathname === '/chat' && request.method === 'GET') {
      const liveSessions = await listSessions()
      sendJson(response, 200, { ok: true, liveSessions })
      return
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      await handleEvents(request, response, session, url)
      return
    }

    sendJson(response, 404, { ok: false, error: 'Not found' })
  } catch (error) {
    logger.warn('Control-plane request failed', {
      method: request.method,
      path: url.pathname,
      error: error instanceof Error ? error.message : String(error),
    })

    sendJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : 'Request failed',
    })
  }
}

const server = createServer((request, response) => {
  void handleRequest(request, response)
})

void ensureAmpSchema()
  .then(() => {
    server.listen(PORT, '0.0.0.0', () => {
      logger.info('Control-plane listening', { port: PORT })
    })
  })
  .catch((error) => {
    logger.error('Control-plane bootstrap failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    process.exit(1)
  })
