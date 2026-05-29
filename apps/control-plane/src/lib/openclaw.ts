import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { listGatewayAgents, listGatewaySessions } from '@/lib/gateway-client'
import type { Agent, SessionInfo } from '@/lib/types'

const STACK_DATA_ROOT = process.env.STACK_DATA_ROOT?.trim() || '/stack-data'

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }

    if (typeof value === 'string' && value.trim() !== '') {
      const parsed = Number(value)

      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }

  return 0
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value
    }
  }

  return ''
}

function pickBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase()

      if (normalized === 'true') {
        return true
      }

      if (normalized === 'false') {
        return false
      }
    }
  }

  return false
}

function mapAgentStatus(value: string): Agent['status'] {
  const normalized = value.toLowerCase()

  if (normalized.includes('work') || normalized.includes('busy') || normalized.includes('run')) {
    return 'working'
  }

  if (normalized.includes('active') || normalized.includes('ready') || normalized.includes('online')) {
    return 'active'
  }

  return 'idle'
}

function normalizeAgentRecord(value: unknown, index: number): Agent | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const usage = (record.usage && typeof record.usage === 'object' ? record.usage : {}) as Record<string, unknown>
  const stats = (record.stats && typeof record.stats === 'object' ? record.stats : {}) as Record<string, unknown>

  const id = pickString(record.id, record.agentId, record.slug, record.name) || `agent-${index + 1}`
  const name = pickString(record.name, record.agentName, record.slug, record.id) || `agent-${index + 1}`
  const model = pickString(record.model, record.providerModel, stats.model) || 'unknown'
  const rawStatus = pickString(record.status, record.state, record.lifecycleState) || 'idle'

  return {
    id,
    name,
    model,
    status: mapAgentStatus(rawStatus),
    tokensIn: pickNumber(record.tokensIn, record.inputTokens, usage.tokensIn, usage.input_tokens, stats.tokensIn),
    tokensOut: pickNumber(record.tokensOut, record.outputTokens, usage.tokensOut, usage.output_tokens, stats.tokensOut),
    costUsd: pickNumber(record.costUsd, record.cost, usage.costUsd, usage.cost_usd, stats.costUsd),
    sessions: pickNumber(record.sessions, usage.sessions, stats.sessions),
    updatedAt: pickString(record.updatedAt, record.lastSeenAt, record.createdAt) || undefined,
  }
}

function normalizeAgentList(payload: unknown) {
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { agents?: unknown[] } | null)?.agents)
      ? (payload as { agents: unknown[] }).agents
      : []

  return records
    .map((record, index) => normalizeAgentRecord(record, index))
    .filter((agent): agent is Agent => Boolean(agent))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function normalizeSessionRecord(value: unknown, index: number): SessionInfo | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const record = value as Record<string, unknown>
  const usage = (record.usage && typeof record.usage === 'object' ? record.usage : {}) as Record<string, unknown>
  const overrides = (record.overrides && typeof record.overrides === 'object' ? record.overrides : {}) as Record<string, unknown>

  const sessionKey = pickString(record.sessionKey, record.key, record.id, record.sessionId) || `session-${index + 1}`
  const agentId = pickString(record.agentId, record.agent, record.ownerAgentId, record.slug) || 'unassigned'
  const totalTokens = pickNumber(record.totalTokens, usage.total_tokens, usage.totalTokens)
  const contextTokens = pickNumber(record.contextTokens, usage.context_tokens, usage.contextTokens, totalTokens)
  const contextLimit = pickNumber(record.contextLimit, record.maxContextTokens, overrides.contextLimit, overrides.maxContextTokens, 128000)
  const usagePct = contextLimit > 0 ? Math.min(100, Math.max(0, (contextTokens / contextLimit) * 100)) : 0

  return {
    sessionKey,
    sessionId: pickString(record.sessionId, record.id) || undefined,
    agentId,
    label: pickString(record.label, record.title, record.name, agentId) || agentId,
    model: pickString(record.model, record.providerModel, overrides.model) || undefined,
    updatedAt: pickString(record.updatedAt, record.lastActivityAt, record.lastMessageAt, record.createdAt) || new Date().toISOString(),
    inputTokens: pickNumber(record.inputTokens, usage.input_tokens, usage.tokensIn),
    outputTokens: pickNumber(record.outputTokens, usage.output_tokens, usage.tokensOut),
    totalTokens,
    contextTokens,
    contextLimit,
    contextUsagePct: Number(usagePct.toFixed(1)),
    fastMode: pickBoolean(record.fastMode, record.fast, overrides.fast),
    verboseMode: pickBoolean(record.verboseMode, record.verbose, overrides.verbose),
    reasoningMode: pickString(record.reasoningMode, record.thinking, overrides.thinking) || undefined,
  }
}

function normalizeSessions(payload: unknown) {
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { sessions?: unknown[] } | null)?.sessions)
      ? (payload as { sessions: unknown[] }).sessions
      : []

  return records
    .map((record, index) => normalizeSessionRecord(record, index))
    .filter((session): session is SessionInfo => Boolean(session))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

function getAgentsDirectory() {
  return join(STACK_DATA_ROOT, 'openclaw', 'config', 'agents')
}

function listAgentsFromFilesystem(): Agent[] {
  const agentsDirectory = getAgentsDirectory()

  if (!existsSync(agentsDirectory)) {
    return []
  }

  return readdirSync(agentsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      name: entry.name,
      model: entry.name === 'main' ? 'default workspace' : 'workspace agent',
      status: 'idle' as const,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      sessions: existsSync(join(agentsDirectory, entry.name, 'sessions'))
        ? readdirSync(join(agentsDirectory, entry.name, 'sessions')).length
        : 0,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function listSessionsFromFilesystem(): SessionInfo[] {
  const agentsDirectory = getAgentsDirectory()

  if (!existsSync(agentsDirectory)) {
    return []
  }

  const sessions: SessionInfo[] = []

  for (const entry of readdirSync(agentsDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const sessionsDirectory = join(agentsDirectory, entry.name, 'sessions')

    if (!existsSync(sessionsDirectory)) {
      continue
    }

    for (const sessionEntry of readdirSync(sessionsDirectory, { withFileTypes: true })) {
      sessions.push({
        sessionKey: `${entry.name}:${sessionEntry.name}`,
        label: sessionEntry.name,
        agentId: entry.name,
        updatedAt: new Date().toISOString(),
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        contextLimit: 128000,
        contextUsagePct: 0,
        fastMode: false,
        verboseMode: false,
      })
    }
  }

  return sessions
}

export async function listAgents() {
  try {
    const response = await listGatewayAgents()
    const agents = normalizeAgentList(response)
    return agents.length > 0 ? agents : listAgentsFromFilesystem()
  } catch {
    return listAgentsFromFilesystem()
  }
}

export async function listSessions() {
  try {
    const response = await listGatewaySessions()
    const sessions = normalizeSessions(response)
    return sessions.length > 0 ? sessions : listSessionsFromFilesystem()
  } catch {
    return listSessionsFromFilesystem()
  }
}
