import { NextRequest, NextResponse } from 'next/server'
import { appendOauthStateCookie, createOauthState, isGitHubOAuthEnabled } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

function buildCallbackUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim()

  if (!baseUrl) {
    throw new Error('APP_BASE_URL is not configured')
  }

  return new URL('/api/auth/github/callback', baseUrl).toString()
}

export async function GET(_request: NextRequest) {
  if (!isGitHubOAuthEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'GitHub OAuth is not configured for this stack.',
      },
      { status: 400 },
    )
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim()

  if (!clientId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'GITHUB_CLIENT_ID is not configured.',
      },
      { status: 500 },
    )
  }

  const { state, token } = createOauthState()
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize')
  authorizeUrl.searchParams.set('client_id', clientId)
  authorizeUrl.searchParams.set('redirect_uri', buildCallbackUrl())
  authorizeUrl.searchParams.set('scope', 'read:user user:email')
  authorizeUrl.searchParams.set('state', state)

  const response = NextResponse.redirect(authorizeUrl)
  appendOauthStateCookie(response, token)

  return response
}
