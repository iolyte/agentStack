export type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
export type StoreStatus = 'healthy' | 'warning' | 'down' | 'unknown'
export type AgentStatus = 'active' | 'idle' | 'working'
export type AppearancePreference = 'system' | 'light' | 'dark'
export type DensityPreference = 'comfortable' | 'compact'
export type TaskStatus = 'backlog' | 'in_progress' | 'blocked' | 'done'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface ServiceHealth {
  name: string
  status: ServiceStatus
  latency?: number
  version?: string
  details?: string
}

export interface Agent {
  id: string
  name: string
  model: string
  status: AgentStatus
  tokensIn: number
  tokensOut: number
  costUsd: number
  sessions: number
  updatedAt?: string
}

export interface SessionInfo {
  sessionKey: string
  sessionId?: string
  agentId: string
  label: string
  model?: string
  updatedAt: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  contextTokens: number
  contextLimit: number
  contextUsagePct: number
  fastMode: boolean
  verboseMode: boolean
  reasoningMode?: string
}

export interface RedisMemoryInfo {
  usedMemoryHuman: string
  usedMemoryPeakHuman: string
  fragmentationRatio: number
  evictedKeys: number
  expiredKeys: number
  keyCount: number
}

export interface QdrantCollectionInfo {
  name: string
  status: string
  pointsCount: number
  vectorsCount: number
}

export interface PersistenceStatus {
  id: 'missionControl' | 'postgres' | 'redis' | 'qdrant' | 'openclaw'
  label: string
  status: StoreStatus
  path: string
  mounted: boolean
  populated: boolean
  details: string
  fileCount?: number
  keyCount?: number
  collectionCount?: number
  detectedFiles?: string[]
  schemaVersion?: string
  lastBootedAt?: string
}

export interface GatewaySnapshot {
  connected: boolean
  agentCount: number
  sessionCount: number
  models: string[]
  agents: Agent[]
  sessions: SessionInfo[]
}

export interface OpenClawConfiguredAgent {
  id: string
  name: string
  workspace: string | null
  agentDir: string | null
  identityName: string | null
  identityTheme: string | null
}

export interface OpenClawConfigSummary {
  path: string
  exists: boolean
  valid: boolean
  lastTouchedVersion: string | null
  lastTouchedAt: string | null
  allowedOrigins: string[]
  configuredAgents: OpenClawConfiguredAgent[]
}

export interface AgentWorkspaceSummary {
  agentId: string
  rootPath: string
  exists: boolean
  fileCount: number
  sessionRegistryCount: number
  modelProviderCount: number
  modelCount: number
  updatedAt: string | null
  files: string[]
}

export interface PersistedChatSession {
  sessionKey: string
  sessionId: string | null
  agentId: string
  updatedAt: string
  sessionFile: string | null
  originLabel: string | null
  deliveryTarget: string | null
}

export interface SetupIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  details: string
  action: string
}

export interface DashboardPreferences {
  appearancePreference: AppearancePreference
  densityPreference: DensityPreference
  showCompletedTasks: boolean
  refreshIntervalSeconds: number
}

export interface MissionControlTask {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export interface TaskSummary {
  total: number
  open: number
  inProgress: number
  blocked: number
  done: number
  highPriorityOpen: number
}

export interface OverviewPayload {
  generatedAt: string
  services: ServiceHealth[]
  persistence: PersistenceStatus[]
  gateway: GatewaySnapshot
  openclawConfig: OpenClawConfigSummary
  setupIssues: SetupIssue[]
  preferences: DashboardPreferences
  tasks: {
    summary: TaskSummary
    recent: MissionControlTask[]
  }
  ui: {
    appearance: AppearancePreference
    density: DensityPreference
    refreshSeconds: number
  }
}
