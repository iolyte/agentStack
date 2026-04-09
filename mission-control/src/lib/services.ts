import net from 'node:net'
import { logger } from '@/lib/logger'
import type { ServiceHealth } from '@/lib/types'

function wsToHttp(url: string) {
  return url.replace(/^ws/i, 'http')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), timeoutMs)

    promise.then(
      (value) => {
        clearTimeout(timeout)
        resolve(value)
      },
      (error) => {
        clearTimeout(timeout)
        reject(error)
      },
    )
  })
}

async function measureHttpService(name: string, url: string, init?: RequestInit): Promise<ServiceHealth> {
  const startedAt = Date.now()

  try {
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })

    return {
      name,
      status: response.ok ? 'healthy' : 'degraded',
      latency: Date.now() - startedAt,
      details: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    logger.warn('Service health check failed', {
      service: name,
      error: error instanceof Error ? error.message : String(error),
    })

    return {
      name,
      status: 'down',
      latency: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function measureTcpService(name: string, rawUrl: string, defaultPort: number): Promise<ServiceHealth> {
  const url = new URL(rawUrl)
  const startedAt = Date.now()

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({
          host: url.hostname,
          port: Number(url.port || defaultPort),
        })
        let settled = false

        const finish = (callback: () => void) => {
          if (settled) {
            return
          }

          settled = true
          socket.removeAllListeners()
          socket.destroy()
          callback()
        }

        socket.once('connect', () => {
          finish(resolve)
        })
        socket.once('error', (error) => finish(() => reject(error)))
        socket.setTimeout(4_000, () => finish(() => reject(new Error('Connection timed out'))))
      }),
      5_000,
      'Connection timed out',
    )

    return {
      name,
      status: 'healthy',
      latency: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      name,
      status: 'down',
      latency: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

async function measureRedisService(name: string, rawUrl: string): Promise<ServiceHealth> {
  const url = new URL(rawUrl)
  const startedAt = Date.now()

  try {
    await withTimeout(
      new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({
          host: url.hostname,
          port: Number(url.port || 6379),
        })
        let settled = false

        const finish = (callback: () => void) => {
          if (settled) {
            return
          }

          settled = true
          socket.removeAllListeners()
          socket.destroy()
          callback()
        }

        socket.once('connect', () => {
          socket.write('*1\r\n$4\r\nPING\r\n')
        })

        socket.once('data', (chunk) => {
          const reply = chunk.toString('utf8')

          if (reply.startsWith('+PONG')) {
            finish(resolve)
            return
          }

          finish(() => reject(new Error(`Unexpected Redis reply: ${reply.trim()}`)))
        })

        socket.once('error', (error) => finish(() => reject(error)))
        socket.setTimeout(4_000, () => finish(() => reject(new Error('Connection timed out'))))
      }),
      5_000,
      'Redis ping timed out',
    )

    return {
      name,
      status: 'healthy',
      latency: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      name,
      status: 'down',
      latency: Date.now() - startedAt,
      details: error instanceof Error ? error.message : String(error),
    }
  }
}

function unknownService(name: string, details: string) {
  return {
    name,
    status: 'unknown',
    details,
  } satisfies ServiceHealth
}

export async function collectStackHealth(): Promise<ServiceHealth[]> {
  const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL
  const gatewayPassword = process.env.OPENCLAW_GATEWAY_PASSWORD?.trim()
  const postgresUrl = process.env.POSTGRES_URL
  const redisUrl = process.env.REDIS_URL
  const qdrantUrl = process.env.QDRANT_URL
  const nginxUrl = process.env.NGINX_URL

  const checks: Array<Promise<ServiceHealth>> = [
    gatewayUrl
      ? measureHttpService('OpenClaw', `${wsToHttp(gatewayUrl)}/health`, {
          headers: gatewayPassword ? { Authorization: `Bearer ${gatewayPassword}` } : undefined,
        })
      : Promise.resolve(unknownService('OpenClaw', 'OPENCLAW_GATEWAY_URL is not configured')),
    postgresUrl
      ? measureTcpService('PostgreSQL', postgresUrl, 5432)
      : Promise.resolve(unknownService('PostgreSQL', 'POSTGRES_URL is not configured')),
    redisUrl
      ? measureRedisService('Redis', redisUrl)
      : Promise.resolve(unknownService('Redis', 'REDIS_URL is not configured')),
    qdrantUrl
      ? measureHttpService('Qdrant', `${qdrantUrl.replace(/\/$/, '')}/healthz`)
      : Promise.resolve(unknownService('Qdrant', 'QDRANT_URL is not configured')),
    nginxUrl
      ? measureHttpService('Nginx', nginxUrl)
      : Promise.resolve(unknownService('Nginx', 'NGINX_URL is not configured')),
    Promise.resolve({
      name: 'Mission Control',
      status: 'healthy',
      latency: 0,
      details: 'Serving dashboard process',
    }),
  ]

  return Promise.all(checks)
}
