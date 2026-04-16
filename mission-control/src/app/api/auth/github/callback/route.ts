import { NextRequest, NextResponse } from 'next/server'
import {
  appendSessionCookie,
  clearOauthStateCookie,
  isGitHubOAuthEnabled,
  verifyOauthState,
} from '@/lib/api-auth'
import { upsertGitHubUser } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

type GitHubTokenResponse = {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
}

type GitHubUserResponse = {
  id: number
  login: string
  name?: string | null
  email?: string | null
  avatar_url?: string | null
}

type GitHubEmailResponse = Array<{
  email: string
  primary: boolean
  verified: boolean
}>

function getAppBaseUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim()

  if (!baseUrl) {
    throw new Error('APP_BASE_URL is not configured')
  }

  return baseUrl
}

function buildCallbackUrl() {
  return new URL('/api/auth/github/callback', getAppBaseUrl()).toString()
}

function buildRedirectUrl(pathname: string) {
  return new URL(pathname, getAppBaseUrl())
}

export async function GET(request: NextRequest) {
  if (!isGitHubOAuthEnabled()) {
    return NextResponse.redirect(buildRedirectUrl('/'))
  }

  const code = request.nextUrl.searchParams.get('code')?.trim()
  const state = request.nextUrl.searchParams.get('state')?.trim()

  if (!code || !state || !verifyOauthState(request, state)) {
    const response = NextResponse.redirect(buildRedirectUrl('/?authError=state'))
    clearOauthStateCookie(response)
    return response
  }

  const clientId = process.env.GITHUB_CLIENT_ID?.trim()
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim()

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(buildRedirectUrl('/?authError=config'))
  }

  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: buildCallbackUrl(),
    }),
  })

  const tokenPayload = (await tokenResponse.json()) as GitHubTokenResponse

  if (!tokenResponse.ok || !tokenPayload.access_token) {
    return NextResponse.redirect(buildRedirectUrl('/?authError=token'))
  }

  const userResponse = await fetch('https://api.github.com/user', {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'clawstack-mission-control',
    },
  })

  if (!userResponse.ok) {
    return NextResponse.redirect(buildRedirectUrl('/?authError=user'))
  }

  const userPayload = (await userResponse.json()) as GitHubUserResponse
  let primaryEmail = userPayload.email ?? null

  if (!primaryEmail) {
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenPayload.access_token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'clawstack-mission-control',
      },
    })

    if (emailResponse.ok) {
      const emailPayload = (await emailResponse.json()) as GitHubEmailResponse
      primaryEmail = emailPayload.find((entry) => entry.primary && entry.verified)?.email
        || emailPayload.find((entry) => entry.verified)?.email
        || null
    }
  }

  const user = await upsertGitHubUser({
    githubId: String(userPayload.id),
    login: userPayload.login,
    name: userPayload.name?.trim() || userPayload.login,
    email: primaryEmail,
    avatarUrl: userPayload.avatar_url ?? null,
  })

  const response = NextResponse.redirect(buildRedirectUrl('/'))
  clearOauthStateCookie(response)
  appendSessionCookie(response, user)

  return response
}
