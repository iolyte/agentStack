import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, isPasswordAuthEnabled } from '@/lib/api-auth'
import { getControlPlaneJson } from '@/lib/control-plane'
import type { WorkspaceSnapshot } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const session = getAuthenticatedSession(request)
  const snapshot = session
    ? await getControlPlaneJson<{ ok: true } & WorkspaceSnapshot>('/workspace', session).catch(() => null)
    : null

  return NextResponse.json({
    ok: true,
    oauthAvailable: isGitHubOAuthEnabled(),
    passwordRequired: isPasswordAuthEnabled(),
    authenticated: Boolean(session),
    authMode: session?.authMode ?? null,
    user: session,
    needsSetup: snapshot?.needsSetup ?? false,
    workspaceId: snapshot?.workspace?.id ?? null,
    projectId: snapshot?.project?.id ?? null,
  })
}
