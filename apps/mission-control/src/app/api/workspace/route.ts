import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, requireApiAuth } from '@/lib/api-auth'
import { getControlPlaneJson } from '@/lib/control-plane'
import type { WorkspaceSnapshot } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const agentId = request.nextUrl.searchParams.get('agentId')?.trim() || undefined
  const payload = await getControlPlaneJson<{ ok: true } & WorkspaceSnapshot>(
    '/workspace',
    session,
    agentId ? { agentId } : undefined,
  )

  return NextResponse.json({
    oauthAvailable: isGitHubOAuthEnabled(),
    ...payload,
  })
}
