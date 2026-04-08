/**
 * OpenClaw Gateway Client
 * Handles WebSocket connection and RPC calls to the OpenClaw gateway
 */

const GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://openclaw:18789'
const GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''

export interface GatewayResponse<T = unknown> {
  ok: boolean
  result?: {
    content: Array<{ type: string; text: string }>
  }
  error?: string
  data?: T
}

/**
 * Invoke a tool on the OpenClaw gateway via HTTP RPC
 */
export async function invokeGatewayTool(tool: string, args: Record<string, unknown> = {}): Promise<GatewayResponse> {
  const httpUrl = GATEWAY_URL.replace(/^ws/, 'http')

  try {
    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({ tool, args }),
      signal: AbortSignal.timeout(15_000),
    })

    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }

    const data = await res.json()
    return { ok: true, ...data }
  } catch (err) {
    return { ok: false, error: String(err) }
  }
}

/**
 * Unwrap gateway response envelope → parsed JSON
 */
export function unwrapGatewayResponse<T>(response: GatewayResponse): T | null {
  try {
    const text = response.result?.content?.[0]?.text
    if (!text) return null
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/**
 * Check gateway health
 */
export async function checkGatewayHealth(): Promise<{ healthy: boolean; latencyMs: number }> {
  const httpUrl = GATEWAY_URL.replace(/^ws/, 'http')
  const start = Date.now()
  try {
    const res = await fetch(`${httpUrl}/health`, {
      headers: { Authorization: `Bearer ${GATEWAY_TOKEN}` },
      signal: AbortSignal.timeout(5_000),
    })
    return { healthy: res.ok, latencyMs: Date.now() - start }
  } catch {
    return { healthy: false, latencyMs: Date.now() - start }
  }
}

/**
 * List all agents from the gateway
 */
export async function listAgents() {
  const response = await invokeGatewayTool('agents.list', {})
  return unwrapGatewayResponse<{ agents: unknown[] }>(response)
}

/**
 * Get gateway status
 */
export async function getGatewayStatus() {
  const response = await invokeGatewayTool('gateway.status', {})
  return unwrapGatewayResponse(response)
}

/**
 * Send a message to an agent
 */
export async function sendAgentMessage(agentId: string, message: string) {
  return invokeGatewayTool('agent.send', { agentId, message })
}
