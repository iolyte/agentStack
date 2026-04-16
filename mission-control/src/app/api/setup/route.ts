import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, isGitHubOAuthEnabled, requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import type { Department } from '@/lib/types'
import { bootstrapWorkspaceForUser } from '@/lib/workspace'

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
    const body = (await request.json()) as {
      goal?: string
      departments?: Department[]
    }
    const snapshot = await bootstrapWorkspaceForUser(session, {
      goal: body.goal?.trim() || '',
      departments: Array.isArray(body.departments) ? body.departments : [],
    })

    return NextResponse.json({
      ok: true,
      oauthAvailable: isGitHubOAuthEnabled(),
      ...snapshot,
    })
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
