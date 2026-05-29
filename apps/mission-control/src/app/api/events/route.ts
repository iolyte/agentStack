import { NextRequest } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { proxyControlPlaneEventStream } from '@/lib/control-plane'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  return proxyControlPlaneEventStream(request, session)
}
