import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { getGatewayConfig, patchGatewayConfig } from '@/lib/gateway-client'
import { logger } from '@/lib/logger'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  return NextResponse.json({
    ok: true,
    config: getOpenClawConfigSummary(),
  })
}

export async function PUT(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const body = (await request.json()) as {
      allowedOrigins?: string[]
    }
    const allowedOrigins = Array.isArray(body.allowedOrigins)
      ? body.allowedOrigins.filter((origin) => typeof origin === 'string' && origin.trim() !== '').map((origin) => origin.trim())
      : []
    const current = await getGatewayConfig().catch(() => ({ hash: undefined as string | undefined }))

    await patchGatewayConfig(
      JSON.stringify(
        {
          gateway: {
            controlUi: {
              allowedOrigins,
            },
          },
        },
        null,
        2,
      ),
      current.hash,
      'Update agentStack control UI allowed origins',
    )

    return NextResponse.json({
      ok: true,
      config: getOpenClawConfigSummary(),
    })
  } catch (error) {
    logger.warn('Mission Control config update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update config',
      },
      { status: 400 },
    )
  }
}
