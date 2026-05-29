import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { logger } from '@/lib/logger'

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://openclaw:18789'
const GATEWAY_PASSWORD = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim() || ''
const PROTOCOL_VERSION = 3
const CLIENT_NAME = 'agentStack-mission-control'

type GatewayEventFrame = {
  type: 'event'
  event: string
  payload?: unknown
}

type GatewayResponseFrame = {
  type: 'res'
  id: string
  ok: boolean
  payload?: unknown
  error?: {
    message?: string
    code?: string
  } | string
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeout: NodeJS.Timeout
}

type GatewayConnectionOptions = {
  scopes?: string[]
}

function getConnectionScopes(options?: GatewayConnectionOptions) {
  return options?.scopes ?? ['operator.read', 'operator.write', 'operator.admin']
}

function normalizeGatewayError(error: unknown) {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return 'Gateway request failed'
}

function buildConnectRequest(id: string, options?: GatewayConnectionOptions) {
  return {
    type: 'req',
    id,
    method: 'connect',
    params: {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: CLIENT_NAME,
        version: process.env.npm_package_version || '1.0.0',
        platform: 'node',
        mode: 'backend',
      },
      role: 'operator',
      scopes: getConnectionScopes(options),
      caps: [],
      commands: [],
      permissions: {},
      auth: GATEWAY_PASSWORD ? { password: GATEWAY_PASSWORD } : {},
      locale: 'en-US',
      userAgent: `${CLIENT_NAME}/${process.env.npm_package_version || '1.0.0'}`,
    },
  }
}

class GatewayConnection {
  private readonly socket: WebSocket
  private readonly pending = new Map<string, PendingRequest>()
  private readyResolver: (() => void) | null = null
  private readyRejecter: ((reason?: unknown) => void) | null = null
  private readonly ready: Promise<void>
  private closed = false
  private eventWaiters: Array<{
    matches: (eventName: string, payload: unknown) => boolean
    resolve: (payload: unknown) => void
    reject: (reason?: unknown) => void
    timeout: NodeJS.Timeout
  }> = []

  private constructor(socket: WebSocket, options?: GatewayConnectionOptions) {
    this.socket = socket
    this.ready = new Promise<void>((resolve, reject) => {
      this.readyResolver = resolve
      this.readyRejecter = reject
    })

    const connectRequestId = randomUUID()

    socket.on('message', (data) => {
      try {
        const frame = JSON.parse(String(data)) as GatewayEventFrame | GatewayResponseFrame

        if (frame.type === 'event') {
          if (frame.event === 'connect.challenge') {
            socket.send(JSON.stringify(buildConnectRequest(connectRequestId, options)))
            return
          }

          for (const waiter of [...this.eventWaiters]) {
            if (!waiter.matches(frame.event, frame.payload)) {
              continue
            }

            clearTimeout(waiter.timeout)
            this.eventWaiters = this.eventWaiters.filter((entry) => entry !== waiter)
            waiter.resolve(frame.payload)
          }

          return
        }

        const pending = this.pending.get(frame.id)

        if (!pending) {
          return
        }

        this.pending.delete(frame.id)
        clearTimeout(pending.timeout)

        if (!frame.ok) {
          pending.reject(new Error(normalizeGatewayError(frame.error)))
          return
        }

        if (frame.id === connectRequestId) {
          this.readyResolver?.()
        }

        pending.resolve(frame.payload ?? null)
      } catch (error) {
        logger.warn('Gateway frame parse failed', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })

    socket.once('error', (error) => {
      this.readyRejecter?.(error)
    })

    socket.once('close', () => {
      this.closed = true
      const error = new Error('Gateway connection closed')

      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout)
        pending.reject(error)
      }

      this.pending.clear()

      for (const waiter of this.eventWaiters) {
        clearTimeout(waiter.timeout)
        waiter.reject(error)
      }

      this.eventWaiters = []
    })
  }

  static async open(options?: GatewayConnectionOptions) {
    const socket = new WebSocket(GATEWAY_URL)
    const connection = new GatewayConnection(socket, options)
    await connection.ready
    return connection
  }

  async request<T>(method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
    if (this.closed) {
      throw new Error('Gateway connection is closed')
    }

    const id = randomUUID()

    const result = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Gateway request timed out for ${method}`))
      }, timeoutMs)

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })
    })

    this.socket.send(
      JSON.stringify({
        type: 'req',
        id,
        method,
        params,
      }),
    )

    return result
  }

  async waitForEvent<T>(matches: (eventName: string, payload: unknown) => boolean, timeoutMs = 30_000): Promise<T> {
    if (this.closed) {
      throw new Error('Gateway connection is closed')
    }

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((entry) => entry.resolve !== resolve)
        reject(new Error('Timed out waiting for gateway event'))
      }, timeoutMs)

      this.eventWaiters.push({
        matches,
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      })
    })
  }

  close() {
    if (this.closed) {
      return
    }

    this.socket.close()
    this.closed = true
  }
}

async function withGatewayConnection<T>(callback: (connection: GatewayConnection) => Promise<T>, options?: GatewayConnectionOptions) {
  const connection = await GatewayConnection.open(options)

  try {
    return await callback(connection)
  } finally {
    connection.close()
  }
}

export async function gatewayRequest<T>(method: string, params: Record<string, unknown> = {}, timeoutMs?: number) {
  return withGatewayConnection((connection) => connection.request<T>(method, params, timeoutMs))
}

export async function listGatewayAgents() {
  return gatewayRequest<{
    agents?: unknown[]
    defaultId?: string
    mainKey?: string
    scope?: string
  }>('agents.list', {})
}

export async function listGatewaySessions() {
  return gatewayRequest<{
    sessions?: unknown[]
  }>('sessions.list', {
    limit: 100,
    includeLastMessage: true,
  })
}

export async function createGatewayAgent(input: {
  name: string
  workspace: string
  emoji?: string
  avatar?: string
}) {
  return gatewayRequest<{
    ok?: boolean
    agentId?: string
    name?: string
    workspace?: string
  }>('agents.create', input)
}

export async function updateGatewayAgent(input: {
  agentId: string
  name?: string
  workspace?: string
  model?: string
  avatar?: string
}) {
  return gatewayRequest<{
    ok?: boolean
    agentId?: string
  }>('agents.update', input)
}

export async function deleteGatewayAgent(input: {
  agentId: string
  deleteFiles?: boolean
}) {
  return gatewayRequest<{
    ok?: boolean
    agentId?: string
  }>('agents.delete', input)
}

export async function listGatewayAgentFiles(agentId: string) {
  return gatewayRequest<{
    agentId: string
    workspace: string
    files: Array<{
      name: string
      path: string
      missing: boolean
      size?: number
      updatedAtMs?: number
      content?: string
    }>
  }>('agents.files.list', { agentId })
}

export async function getGatewayAgentFile(agentId: string, name: string) {
  return gatewayRequest<{
    agentId: string
    workspace: string
    file: {
      name: string
      path: string
      missing: boolean
      size?: number
      updatedAtMs?: number
      content?: string
    }
  }>('agents.files.get', { agentId, name })
}

export async function setGatewayAgentFile(agentId: string, name: string, content: string) {
  return gatewayRequest<{
    ok?: boolean
    agentId?: string
    workspace?: string
    file?: {
      name: string
      path: string
      missing: boolean
      size?: number
      updatedAtMs?: number
      content?: string
    }
  }>('agents.files.set', { agentId, name, content })
}

export async function getGatewayConfig() {
  return gatewayRequest<{
    raw?: string
    hash?: string
  }>('config.get', {})
}

export async function patchGatewayConfig(raw: string, baseHash?: string, note?: string) {
  return gatewayRequest<{
    ok?: boolean
    hash?: string
    raw?: string
  }>('config.patch', {
    raw,
    ...(baseHash ? { baseHash } : {}),
    ...(note ? { note } : {}),
  })
}

function parseChatHistoryMessages(historyPayload: unknown) {
  if (Array.isArray(historyPayload)) {
    return historyPayload
  }

  if (historyPayload && typeof historyPayload === 'object' && Array.isArray((historyPayload as { messages?: unknown[] }).messages)) {
    return (historyPayload as { messages: unknown[] }).messages
  }

  return []
}

export async function ensureGatewaySession(key: string, agentId: string, label?: string) {
  try {
    await gatewayRequest('sessions.create', {
      key,
      agentId,
      ...(label ? { label } : {}),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    if (!message.toLowerCase().includes('exists')) {
      logger.warn('Gateway session bootstrap failed', {
        key,
        agentId,
        error: message,
      })
    }
  }
}

export async function sendGatewayChatMessage(input: {
  sessionKey: string
  agentId: string
  message: string
  timeoutMs?: number
}) {
  return withGatewayConnection(async (connection) => {
    await connection.request('sessions.create', {
      key: input.sessionKey,
      agentId: input.agentId,
      label: input.agentId,
    }).catch(() => null)

    const idempotencyKey = randomUUID()
    const timeoutMs = input.timeoutMs ?? 90_000
    const response = await connection.request<{
      runId?: string
      status?: string
    }>('chat.send', {
      sessionKey: input.sessionKey,
      message: input.message,
      timeoutMs,
      idempotencyKey,
    }, 10_000)

    const runId = response?.runId

    if (runId) {
      await connection.waitForEvent<{
        runId: string
        sessionKey: string
        state: string
        message?: unknown
        errorMessage?: string
      }>(
        (eventName, payload) =>
          eventName === 'chat'
          && Boolean(payload)
          && typeof payload === 'object'
          && (payload as { runId?: string }).runId === runId
          && ['final', 'aborted', 'error'].includes((payload as { state?: string }).state || ''),
        timeoutMs + 15_000,
      )
    }

    const history = await connection.request<unknown>('chat.history', {
      sessionKey: input.sessionKey,
      limit: 40,
    }, 10_000)

    return {
      runId: runId || null,
      history: parseChatHistoryMessages(history),
    }
  })
}
