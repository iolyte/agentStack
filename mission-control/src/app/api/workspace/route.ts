import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, requireApiAuth } from '@/lib/api-auth'
import { getWorkspaceSnapshotForUser } from '@/lib/workspace'

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
  const snapshot = await getWorkspaceSnapshotForUser(session, { agentId })

  return NextResponse.json({
    ok: true,
    oauthAvailable: isGitHubOAuthEnabled(),
    ...snapshot,
  })
}
