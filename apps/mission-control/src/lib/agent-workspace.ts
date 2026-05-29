import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { AgentWorkspaceSummary, PersistedChatSession } from '@/lib/types'

const STACK_DATA_ROOT = process.env.STACK_DATA_ROOT?.trim() || '/stack-data'
const AGENTS_ROOT = join(STACK_DATA_ROOT, 'openclaw', 'config', 'agents')
const MAX_FILES_PER_AGENT = 12

type SessionRegistryRecord = {
  sessionId?: string
  updatedAt?: number | string
  sessionFile?: string
  origin?: {
    label?: string
    to?: string
  }
  deliveryContext?: {
    to?: string
  }
}

type ModelsCatalog = {
  providers?: Record<string, { models?: unknown[] }>
}

function isSafeAgentId(value: string) {
  return /^[a-zA-Z0-9._-]+$/.test(value)
}

function toIsoTimestamp(value: number | string | undefined) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString()
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value)

    if (Number.isFinite(numeric)) {
      return new Date(numeric).toISOString()
    }

    const parsed = Date.parse(value)

    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString()
    }
  }

  return new Date(0).toISOString()
}

function safeReadJson<T>(path: string): T | null {
  if (!existsSync(path)) {
    return null
  }

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

function walkFiles(rootPath: string, currentPath = rootPath, files: string[] = []) {
  if (!existsSync(currentPath) || files.length >= MAX_FILES_PER_AGENT) {
    return files
  }

  for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
    const absolutePath = join(currentPath, entry.name)

    if (entry.isDirectory()) {
      walkFiles(rootPath, absolutePath, files)
    } else {
      files.push(relative(rootPath, absolutePath))
    }

    if (files.length >= MAX_FILES_PER_AGENT) {
      break
    }
  }

  return files
}

function countFiles(path: string): number {
  if (!existsSync(path)) {
    return 0
  }

  let count = 0

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolutePath = join(path, entry.name)

    if (entry.isDirectory()) {
      count += countFiles(absolutePath)
      continue
    }

    count += 1
  }

  return count
}

function getUpdatedAt(path: string) {
  try {
    return statSync(path).mtime.toISOString()
  } catch {
    return null
  }
}

function getAgentPath(agentId: string) {
  if (!isSafeAgentId(agentId)) {
    return null
  }

  return join(AGENTS_ROOT, agentId)
}

function getModelCatalogCounts(agentPath: string) {
  const catalog = safeReadJson<ModelsCatalog>(join(agentPath, 'agent', 'models.json'))

  if (!catalog?.providers) {
    return {
      modelProviderCount: 0,
      modelCount: 0,
    }
  }

  const providers = Object.values(catalog.providers)

  return {
    modelProviderCount: providers.length,
    modelCount: providers.reduce((total, provider) => total + (Array.isArray(provider.models) ? provider.models.length : 0), 0),
  }
}

function readSessionRegistry(agentId: string) {
  const agentPath = getAgentPath(agentId)

  if (!agentPath) {
    return [] as PersistedChatSession[]
  }

  const registry = safeReadJson<Record<string, SessionRegistryRecord>>(join(agentPath, 'sessions', 'sessions.json'))

  if (!registry) {
    return [] as PersistedChatSession[]
  }

  return Object.entries(registry)
    .map(([sessionKey, record]) => ({
      sessionKey,
      sessionId: typeof record.sessionId === 'string' && record.sessionId.trim() !== '' ? record.sessionId : null,
      agentId,
      updatedAt: toIsoTimestamp(record.updatedAt),
      sessionFile: typeof record.sessionFile === 'string' && record.sessionFile.trim() !== '' ? record.sessionFile : null,
      originLabel: typeof record.origin?.label === 'string' && record.origin.label.trim() !== '' ? record.origin.label : null,
      deliveryTarget: typeof record.deliveryContext?.to === 'string' && record.deliveryContext.to.trim() !== ''
        ? record.deliveryContext.to
        : typeof record.origin?.to === 'string' && record.origin.to.trim() !== ''
          ? record.origin.to
          : null,
    }))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export function listAgentWorkspaceSummaries(): AgentWorkspaceSummary[] {
  if (!existsSync(AGENTS_ROOT)) {
    return []
  }

  return readdirSync(AGENTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const agentPath = join(AGENTS_ROOT, entry.name)
      const sessionRegistry = readSessionRegistry(entry.name)
      const modelCatalogCounts = getModelCatalogCounts(agentPath)

      return {
        agentId: entry.name,
        rootPath: agentPath,
        exists: true,
        fileCount: countFiles(agentPath),
        sessionRegistryCount: sessionRegistry.length,
        modelProviderCount: modelCatalogCounts.modelProviderCount,
        modelCount: modelCatalogCounts.modelCount,
        updatedAt: getUpdatedAt(agentPath),
        files: walkFiles(agentPath).sort((left, right) => left.localeCompare(right)),
      } satisfies AgentWorkspaceSummary
    })
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
}

export function getAgentWorkspaceSummary(agentId: string) {
  const agentPath = getAgentPath(agentId)

  if (!agentPath || !existsSync(agentPath)) {
    return null
  }

  return listAgentWorkspaceSummaries().find((summary) => summary.agentId === agentId) ?? null
}

export function listPersistedChatSessions(): PersistedChatSession[] {
  return listAgentWorkspaceSummaries()
    .flatMap((summary) => readSessionRegistry(summary.agentId))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}
