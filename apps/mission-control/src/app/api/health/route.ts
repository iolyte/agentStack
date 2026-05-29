import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { collectStackHealth } from '@/lib/services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const services = await collectStackHealth()
  const response: Record<string, { healthy: boolean; latencyMs: number | null; details: string | null }> = Object.fromEntries(
    services.map((service) => [
      service.name.toLowerCase().replace(/\s+/g, '_'),
      {
        healthy: service.status === 'healthy',
        latencyMs: typeof service.latency === 'number' ? service.latency : null,
        details: service.details ?? null,
      },
    ]),
  )

  return NextResponse.json({
    ok: true,
    services,
    ...response,
    timestamp: new Date().toISOString(),
  })
}
