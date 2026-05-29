import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { listPersistedChatSessions } from '@/lib/agent-workspace'
import { proxyControlPlaneJson } from '@/lib/control-plane'
import { logger } from '@/lib/logger'
import { listSessions } from '@/lib/openclaw'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const [liveSessions, persistedSessions] = await Promise.all([
    listSessions(),
    Promise.resolve(listPersistedChatSessions()),
  ])

  return NextResponse.json({
    ok: true,
    liveSessions,
    persistedSessions,
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
    return proxyControlPlaneJson(request, session, '/chat')
  } catch (error) {
    logger.warn('Chat send failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to send the message',
      },
      { status: 400 },
    )
  }
}
