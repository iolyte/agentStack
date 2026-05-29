import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OpenClawConfigSummary, OpenClawConfiguredAgent } from '@/lib/types'

const STACK_DATA_ROOT = process.env.STACK_DATA_ROOT?.trim() || '/stack-data'

type OpenClawConfigFile = {
  gateway?: {
    controlUi?: {
      allowedOrigins?: string[]
    }
  }
  meta?: {
    lastTouchedVersion?: string
    lastTouchedAt?: string
  }
  agents?: {
    list?: Array<{
      id?: string
      name?: string
      workspace?: string
      agentDir?: string
      identity?: {
        name?: string
        theme?: string
      }
    }>
  }
}

function getConfigPath() {
  return join(STACK_DATA_ROOT, 'openclaw', 'config', 'openclaw.json')
}

function normalizeConfiguredAgents(config: OpenClawConfigFile): OpenClawConfiguredAgent[] {
  const records = Array.isArray(config.agents?.list) ? config.agents.list : []

  return records
    .map((agent, index) => ({
      id: agent.id?.trim() || `agent-${index + 1}`,
      name: agent.name?.trim() || agent.id?.trim() || `agent-${index + 1}`,
      workspace: agent.workspace?.trim() || null,
      agentDir: agent.agentDir?.trim() || null,
      identityName: agent.identity?.name?.trim() || null,
      identityTheme: agent.identity?.theme?.trim() || null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function getOpenClawConfigSummary(): OpenClawConfigSummary {
  const path = getConfigPath()

  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      valid: false,
      lastTouchedVersion: null,
      lastTouchedAt: null,
      allowedOrigins: [],
      configuredAgents: [],
    }
  }

  try {
    const config = JSON.parse(readFileSync(path, 'utf8')) as OpenClawConfigFile

    return {
      path,
      exists: true,
      valid: true,
      lastTouchedVersion: config.meta?.lastTouchedVersion?.trim() || null,
      lastTouchedAt: config.meta?.lastTouchedAt?.trim() || null,
      allowedOrigins: Array.isArray(config.gateway?.controlUi?.allowedOrigins)
        ? config.gateway?.controlUi?.allowedOrigins.filter((origin) => typeof origin === 'string' && origin.trim() !== '')
        : [],
      configuredAgents: normalizeConfiguredAgents(config),
    }
  } catch {
    return {
      path,
      exists: true,
      valid: false,
      lastTouchedVersion: null,
      lastTouchedAt: null,
      allowedOrigins: [],
      configuredAgents: [],
    }
  }
}
