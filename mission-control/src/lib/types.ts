export type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
export type StoreStatus = 'healthy' | 'warning' | 'down' | 'unknown'
export type AgentStatus = 'active' | 'idle' | 'working'

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

export interface SetupIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  details: string
  action: string
}

export interface OverviewPayload {
  generatedAt: string
  services: ServiceHealth[]
  persistence: PersistenceStatus[]
  gateway: GatewaySnapshot
  setupIssues: SetupIssue[]
  ui: {
    appearance: 'system'
    refreshSeconds: number
  }
}
