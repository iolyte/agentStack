import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { setGatewayAgentFile } from '@/lib/gateway-client'
import { getAgentWorkspaceSummary, listAgentWorkspaceSummaries } from '@/lib/agent-workspace'
import { logger } from '@/lib/logger'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const agentId = request.nextUrl.searchParams.get('agentId')?.trim()

  if (agentId) {
    const summary = getAgentWorkspaceSummary(agentId)

    if (!summary) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Agent workspace was not found.',
        },
        { status: 404 },
      )
    }

    return NextResponse.json({
      ok: true,
      agent: summary,
    })
  }

  return NextResponse.json({
    ok: true,
    agents: listAgentWorkspaceSummaries(),
  })
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const body = (await request.json()) as {
      agentId?: string
      name?: string
      content?: string
    }

    if (!body.agentId?.trim() || !body.name?.trim()) {
      throw new Error('agentId and name are required')
    }

    const result = await setGatewayAgentFile(body.agentId.trim(), body.name.trim(), body.content ?? '')

    return NextResponse.json({
      ok: true,
      file: result.file ?? null,
    })
  } catch (error) {
    logger.warn('Agent file update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update the agent file',
      },
      { status: 400 },
    )
  }
}
