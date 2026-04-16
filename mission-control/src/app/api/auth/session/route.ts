import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, isPasswordAuthEnabled } from '@/lib/api-auth'
import { ensureLocalOperatorUser, getWorkspaceSnapshotForUser } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = getAuthenticatedSession(request)

  if (session?.authMode === 'local') {
    await ensureLocalOperatorUser()
  }

  const snapshot = session ? await getWorkspaceSnapshotForUser(session) : null

  return NextResponse.json({
    ok: true,
    oauthAvailable: isGitHubOAuthEnabled(),
    passwordRequired: isPasswordAuthEnabled(),
    authenticated: Boolean(session),
    authMode: session?.authMode ?? null,
    user: session,
    needsSetup: snapshot?.needsSetup ?? false,
  })
}
