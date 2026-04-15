import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { getAgentWorkspaceSummary, listAgentWorkspaceSummaries } from '@/lib/agent-workspace'
import { notImplementedResponse } from '@/lib/not-implemented'

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

  return notImplementedResponse()
}
