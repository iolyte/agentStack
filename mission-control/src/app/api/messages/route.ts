import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { listMessagesForAgentForUser, sendMessageToAgentForUser } from '@/lib/workspace'

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

  const agentId = request.nextUrl.searchParams.get('agentId')?.trim()

  if (!agentId) {
    return NextResponse.json({ ok: false, error: 'agentId is required' }, { status: 400 })
  }

  try {
    const messages = await listMessagesForAgentForUser(session, agentId)

    return NextResponse.json({
      ok: true,
      messages,
    })
  } catch (error) {
    logger.warn('Workspace messages fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to load messages',
      },
      { status: 400 },
    )
  }
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
    const body = (await request.json()) as {
      agentId?: string
      content?: string
    }

    if (!body.agentId?.trim()) {
      throw new Error('agentId is required')
    }

    const messages = await sendMessageToAgentForUser(session, {
      agentId: body.agentId.trim(),
      content: body.content?.trim() || '',
    })

    return NextResponse.json({
      ok: true,
      messages,
    })
  } catch (error) {
    logger.warn('Workspace message send failed', {
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
