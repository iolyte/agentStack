import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, requireApiAuth } from '@/lib/api-auth'
import { proxyControlPlaneJson } from '@/lib/control-plane'
import { logger } from '@/lib/logger'
import type { Department } from '@/lib/types'

export const dynamic = 'force-dynamic'

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
    const response = await proxyControlPlaneJson(request, session, '/setup')
    const payload = await response.json()
    return NextResponse.json({
      ...payload,
      oauthAvailable: isGitHubOAuthEnabled(),
    }, { status: response.status })
  } catch (error) {
    logger.warn('Workspace bootstrap failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to initialize the workspace',
      },
      { status: 400 },
    )
  }
}
