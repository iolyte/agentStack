import { NextRequest, NextResponse } from 'next/server'
import type { AuthenticatedUser } from '@/lib/types'

const CONTROL_PLANE_URL = process.env.CONTROL_PLANE_URL?.trim() || 'http://control-plane:4100'
const INTERNAL_TOKEN = process.env.CLAWSTACK_INTERNAL_TOKEN?.trim()
  || process.env.MC_SESSION_SECRET?.trim()
  || 'clawstack-internal'

function buildHeaders(session: AuthenticatedUser, extra?: HeadersInit) {
  const headers = new Headers(extra)
  headers.set('x-clawstack-internal-token', INTERNAL_TOKEN)
  headers.set('x-clawstack-user', Buffer.from(JSON.stringify(session)).toString('base64url'))
  return headers
}

function buildUrl(pathname: string, request?: NextRequest) {
  const url = new URL(pathname, CONTROL_PLANE_URL)

  if (request) {
    request.nextUrl.searchParams.forEach((value, key) => {
      url.searchParams.set(key, value)
    })
  }

  return url
}

export async function proxyControlPlaneJson(
  request: NextRequest,
  session: AuthenticatedUser,
  pathname: string,
) {
  const response = await fetch(buildUrl(pathname, request), {
    method: request.method,
    headers: buildHeaders(session, {
      'Content-Type': request.headers.get('content-type') || 'application/json',
    }),
    body: request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.text(),
    cache: 'no-store',
  })

  return new NextResponse(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') || 'application/json; charset=utf-8',
    },
  })
}

export async function getControlPlaneJson<T>(pathname: string, session: AuthenticatedUser, search?: Record<string, string>) {
  const url = new URL(pathname, CONTROL_PLANE_URL)

  for (const [key, value] of Object.entries(search ?? {})) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    headers: buildHeaders(session),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Control-plane request failed: ${response.status}`)
  }

  return response.json() as Promise<T>
}

export async function proxyControlPlaneEventStream(request: NextRequest, session: AuthenticatedUser) {
  const response = await fetch(buildUrl('/events', request), {
    headers: buildHeaders(session, {
      'last-event-id': request.headers.get('last-event-id') || '',
    }),
    cache: 'no-store',
  })

  return new Response(response.body, {
    status: response.status,
    headers: {
      'Cache-Control': response.headers.get('cache-control') || 'no-cache, no-transform',
      Connection: response.headers.get('connection') || 'keep-alive',
      'Content-Type': response.headers.get('content-type') || 'text/event-stream; charset=utf-8',
    },
  })
}
