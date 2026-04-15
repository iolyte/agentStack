import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { notImplementedResponse } from '@/lib/not-implemented'

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

  return notImplementedResponse()
}
