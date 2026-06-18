import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { proxyControlPlaneJson } from '@/lib/control-plane'
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

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return proxyControlPlaneJson(request, session, '/agent-files')
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
