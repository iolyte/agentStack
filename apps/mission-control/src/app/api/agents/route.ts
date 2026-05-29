import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { proxyControlPlaneJson } from '@/lib/control-plane'
import { logger } from '@/lib/logger'

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

  return proxyControlPlaneJson(request, session, '/agents')
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
    return proxyControlPlaneJson(request, session, '/agents')
  } catch (error) {
    logger.warn('Workspace agent creation failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to create the agent',
      },
      { status: 400 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return proxyControlPlaneJson(request, session, '/agents')
  } catch (error) {
    logger.warn('Workspace agent update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update the agent',
      },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    return proxyControlPlaneJson(request, session, '/agents')
  } catch (error) {
    logger.warn('Workspace agent deletion failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to delete the agent',
      },
      { status: 400 },
    )
  }
}
