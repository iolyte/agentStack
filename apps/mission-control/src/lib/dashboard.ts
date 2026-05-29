import { inspectPersistence } from '@/lib/persistence'
import { getDashboardPreferences } from '@/lib/preferences'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { listAgents, listSessions } from '@/lib/openclaw'
import { collectStackHealth } from '@/lib/services'
import { logger } from '@/lib/logger'
import { listMissionControlTasks, summarizeTasks } from '@/lib/tasks'
import type { GatewaySnapshot, OverviewPayload, PersistenceStatus, ServiceHealth, SetupIssue } from '@/lib/types'

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort((left, right) => left.localeCompare(right))
}

async function resolveGatewaySnapshot(services: ServiceHealth[]): Promise<GatewaySnapshot> {
  const gatewayServiceHealthy = services.some((service) => service.name === 'OpenClaw' && service.status === 'healthy')
  const [agentsResult, sessionsResult] = await Promise.allSettled([listAgents(), listSessions()])

  if (agentsResult.status === 'rejected') {
    logger.warn('Unable to load agents from OpenClaw', {
      error: agentsResult.reason instanceof Error ? agentsResult.reason.message : String(agentsResult.reason),
    })
  }

  if (sessionsResult.status === 'rejected') {
    logger.warn('Unable to load sessions from OpenClaw', {
      error: sessionsResult.reason instanceof Error ? sessionsResult.reason.message : String(sessionsResult.reason),
    })
  }

  const agents = agentsResult.status === 'fulfilled' ? agentsResult.value : []
  const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value : []

  return {
    connected: gatewayServiceHealthy,
    agentCount: agents.length,
    sessionCount: sessions.length,
    models: uniqueStrings(agents.map((agent) => agent.model)),
    agents,
    sessions,
  }
}

function buildSetupIssues(
  services: ServiceHealth[],
  persistence: PersistenceStatus[],
  gateway: GatewaySnapshot,
  openclawConfig: ReturnType<typeof getOpenClawConfigSummary>,
) {
  const issues: SetupIssue[] = []

  for (const service of services) {
    if (service.status === 'healthy') {
      continue
    }

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
          action: store.id === 'redis'
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
      title: 'Mission Control is not connected to the OpenClaw gateway',
      details: 'The dashboard is running, but live gateway data could not be confirmed.',
      action: 'Confirm the gateway password in `.env` and restart the stack.',
    })
  }

  if (!openclawConfig.exists) {
    issues.push({
      id: 'openclaw-config-missing',
      severity: 'warning',
      title: 'OpenClaw config file is missing',
      details: 'Mission Control could not find the persisted OpenClaw config file on disk.',
      action: 'Verify `.data/openclaw/config/openclaw.json` exists and restart the stack if needed.',
    })
  } else if (!openclawConfig.valid) {
    issues.push({
      id: 'openclaw-config-invalid',
      severity: 'warning',
      title: 'OpenClaw config file is not valid JSON',
      details: 'Mission Control found the config file but could not parse it safely.',
      action: 'Inspect the config file and run `openclaw config validate --json` inside the gateway container.',
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
  const tasks = await listMissionControlTasks(preferences.showCompletedTasks)

  return {
    generatedAt: new Date().toISOString(),
    services,
    persistence,
    gateway,
    openclawConfig,
    setupIssues: buildSetupIssues(services, persistence, gateway, openclawConfig),
    preferences,
    tasks: {
      summary: summarizeTasks(tasks),
      recent: tasks.slice(0, 8),
    },
    ui: {
      appearance: preferences.appearancePreference,
      density: preferences.densityPreference,
      refreshSeconds: preferences.refreshIntervalSeconds,
    },
  }
}
