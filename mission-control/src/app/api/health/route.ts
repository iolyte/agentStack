import { NextResponse } from 'next/server'
import { checkGatewayHealth } from '@/lib/openclaw'

export const dynamic = 'force-dynamic'

export async function GET() {
  const [gateway, postgres, redis, qdrant] = await Promise.allSettled([
    checkGatewayHealth(),
    checkServiceHealth(process.env.POSTGRES_URL ? 'postgres' : null),
    checkServiceHealth(process.env.REDIS_URL ? 'redis' : null),
    checkQdrantHealth(),
  ])

  return NextResponse.json({
    gateway: gateway.status === 'fulfilled' ? gateway.value : { healthy: false, latencyMs: 0 },
    postgres: postgres.status === 'fulfilled' ? postgres.value : { healthy: false },
    redis: redis.status === 'fulfilled' ? redis.value : { healthy: false },
    qdrant: qdrant.status === 'fulfilled' ? qdrant.value : { healthy: false },
    timestamp: Date.now(),
  })
}

async function checkServiceHealth(service: string | null) {
  if (!service) return { healthy: false }
  // Simplified — in production, use actual pg/redis ping
  return { healthy: true }
}

async function checkQdrantHealth() {
  const url = process.env.QDRANT_URL || 'http://qdrant:6333'
  try {
    const res = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(3000) })
    return { healthy: res.ok }
  } catch {
    return { healthy: false }
  }
}
