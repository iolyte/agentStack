import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { listPersistedChatSessions } from '@/lib/agent-workspace'
import { listSessions } from '@/lib/openclaw'
import { notImplementedResponse } from '@/lib/not-implemented'

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

  return notImplementedResponse()
}
