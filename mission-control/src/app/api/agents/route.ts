import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { listAgents } from '@/lib/openclaw'
import { notImplementedResponse } from '@/lib/not-implemented'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const [liveAgents, config] = await Promise.all([listAgents(), Promise.resolve(getOpenClawConfigSummary())])

  return NextResponse.json({
    ok: true,
    liveAgents,
    configuredAgents: config.configuredAgents,
  })
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  return notImplementedResponse()
}

export async function PATCH(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  return notImplementedResponse()
}
