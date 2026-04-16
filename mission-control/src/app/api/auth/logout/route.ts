import { NextResponse } from 'next/server'
import { clearOauthStateCookie, clearSessionCookie } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST() {
  const response = NextResponse.json({
    ok: true,
    authenticated: false,
  })

  clearSessionCookie(response)
  clearOauthStateCookie(response)

  return response
}
