import net from 'node:net'
import type { QdrantCollectionInfo, RedisMemoryInfo } from '@/lib/types'

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

function encodeRedisCommand(args: string[]) {
  return `*${args.length}\r\n${args.map((arg) => `$${Buffer.byteLength(arg)}\r\n${arg}\r\n`).join('')}`
}

async function runRedisCommand(rawUrl: string, args: string[]) {
  const url = new URL(rawUrl)

  return withTimeout(
    new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({
        host: url.hostname,
        port: Number(url.port || 6379),
      })

      let buffer = ''
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
        socket.write(encodeRedisCommand(args))
      })

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8')

        if (buffer.endsWith('\r\n')) {
          finish(() => resolve(buffer))
        }
      })

      socket.once('error', (error) => finish(() => reject(error)))
      socket.setTimeout(4_000, () => finish(() => reject(new Error('Redis command timed out'))))
    }),
    5_000,
    'Redis command timed out',
  )
}

function decodeRedisBulkString(reply: string) {
  if (!reply.startsWith('$')) {
    return ''
  }

  const [, ...rest] = reply.split('\r\n')
  return rest.join('\n').trim()
}

function parseInfoSection(raw: string) {
  const body = raw.startsWith('$') ? decodeRedisBulkString(raw) : raw
  const result: Record<string, string> = {}

  for (const line of body.split('\n')) {
    const trimmed = line.trim()

    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes(':')) {
      continue
    }

    const separatorIndex = trimmed.indexOf(':')
    result[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1)
  }

  return result
}

function toNumber(value: string | undefined) {
  if (!value) {
    return 0
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export async function getRedisMemoryInfo(rawUrl: string): Promise<RedisMemoryInfo | null> {
  try {
    const [memoryReply, statsReply, sizeReply] = await Promise.all([
      runRedisCommand(rawUrl, ['INFO', 'MEMORY']),
      runRedisCommand(rawUrl, ['INFO', 'STATS']),
      runRedisCommand(rawUrl, ['DBSIZE']),
    ])
    const memory = parseInfoSection(memoryReply)
    const stats = parseInfoSection(statsReply)
    const keyCount = sizeReply.startsWith(':') ? toNumber(sizeReply.slice(1)) : 0

    return {
      usedMemoryHuman: memory.used_memory_human || '0B',
      usedMemoryPeakHuman: memory.used_memory_peak_human || '0B',
      fragmentationRatio: Number(toNumber(memory.mem_fragmentation_ratio).toFixed(2)),
      evictedKeys: toNumber(stats.evicted_keys),
      expiredKeys: toNumber(stats.expired_keys),
      keyCount,
    }
  } catch {
    return null
  }
}

export async function pruneRedisMemory(rawUrl: string) {
  const reply = await runRedisCommand(rawUrl, ['MEMORY', 'PURGE'])

  if (!reply.startsWith('+OK')) {
    throw new Error(`Unexpected Redis reply: ${reply.trim()}`)
  }
}

export async function getQdrantCollections(rawUrl: string): Promise<QdrantCollectionInfo[]> {
  try {
    const response = await fetch(`${rawUrl.replace(/\/$/, '')}/collections`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })

    if (!response.ok) {
      return []
    }

    const payload = (await response.json()) as {
      result?: {
        collections?: Array<{ name: string }>
      }
    }

    const collectionNames = payload.result?.collections?.map((collection) => collection.name) ?? []

    const collectionStats = await Promise.all(
      collectionNames.map(async (name) => {
        try {
          const detailsResponse = await fetch(`${rawUrl.replace(/\/$/, '')}/collections/${encodeURIComponent(name)}`, {
            cache: 'no-store',
            signal: AbortSignal.timeout(5_000),
          })

          if (!detailsResponse.ok) {
            return {
              name,
              status: 'unknown',
              pointsCount: 0,
              vectorsCount: 0,
            } satisfies QdrantCollectionInfo
          }

          const details = (await detailsResponse.json()) as {
            result?: {
              status?: string
              points_count?: number
              vectors_count?: number
            }
          }

          return {
            name,
            status: details.result?.status || 'healthy',
            pointsCount: details.result?.points_count ?? 0,
            vectorsCount: details.result?.vectors_count ?? 0,
          } satisfies QdrantCollectionInfo
        } catch {
          return {
            name,
            status: 'unknown',
            pointsCount: 0,
            vectorsCount: 0,
          } satisfies QdrantCollectionInfo
        }
      }),
    )

    return collectionStats.sort((left, right) => right.pointsCount - left.pointsCount)
  } catch {
    return []
  }
}
