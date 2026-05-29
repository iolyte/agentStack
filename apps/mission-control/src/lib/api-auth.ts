import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { AuthMode, AuthenticatedUser } from '@/lib/types'

const SESSION_COOKIE_NAME = 'mission-control-session'
const OAUTH_STATE_COOKIE_NAME = 'mission-control-oauth-state'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
const OAUTH_STATE_TTL_MS = 1000 * 60 * 10
const LOCAL_OPERATOR_ID = 'local-operator'

type SessionTokenPayload = {
  sub: string
  login: string
  name: string
  email?: string | null
  avatarUrl?: string | null
  authMode: AuthMode
  exp: number
  iat: number
}

type OauthStatePayload = {
  state: string
  exp: number
}

function getConfiguredPassword() {
  return process.env.MC_ADMIN_PASSWORD?.trim() || process.env.MC_PASSWORD?.trim() || null
}

function getSigningSecret() {
  return process.env.AUTH_JWT_SECRET?.trim()
    || process.env.MC_SESSION_SECRET?.trim()
    || getConfiguredPassword()
    || 'agentstack'
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString('base64url')
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signValue(value: string) {
  return createHmac('sha256', getSigningSecret()).update(value).digest('base64url')
}

function buildSignedToken<T extends Record<string, unknown>>(payload: T) {
  const header = {
    alg: 'HS256',
    typ: 'JWT',
  }
  const encodedHeader = encodeBase64Url(JSON.stringify(header))
  const encodedPayload = encodeBase64Url(JSON.stringify(payload))
  const signature = signValue(`${encodedHeader}.${encodedPayload}`)

  return `${encodedHeader}.${encodedPayload}.${signature}`
}

function parseSignedToken<T>(value: string | undefined) {
  if (!value) {
    return null
  }

  const [encodedHeader, encodedPayload, signature] = value.split('.')

  if (!encodedHeader || !encodedPayload || !signature) {
    return null
  }

  const expectedSignature = signValue(`${encodedHeader}.${encodedPayload}`)

  if (!safeEqual(signature, expectedSignature)) {
    return null
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload)) as T
  } catch {
    return null
  }
}

function buildCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.MC_SECURE_COOKIES === 'true',
    path: '/',
    maxAge: maxAgeSeconds,
  }
}

function buildSessionPayload(user: AuthenticatedUser): SessionTokenPayload {
  const nowSeconds = Math.floor(Date.now() / 1000)

  return {
    sub: user.id,
    login: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    authMode: user.authMode,
    iat: nowSeconds,
    exp: nowSeconds + Math.floor(SESSION_TTL_MS / 1000),
  }
}

function parseSessionPayload(rawValue: string | undefined): AuthenticatedUser | null {
  const payload = parseSignedToken<SessionTokenPayload>(rawValue)

  if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) {
    return null
  }

  return {
    id: payload.sub,
    login: payload.login,
    name: payload.name,
    email: payload.email ?? null,
    avatarUrl: payload.avatarUrl ?? null,
    authMode: payload.authMode,
  }
}

function parseOauthState(rawValue: string | undefined) {
  const payload = parseSignedToken<OauthStatePayload>(rawValue)

  if (!payload || payload.exp <= Date.now()) {
    return null
  }

  return payload
}

export function isGitHubOAuthEnabled() {
  return Boolean(
    process.env.GITHUB_CLIENT_ID?.trim()
    && process.env.GITHUB_CLIENT_SECRET?.trim()
    && process.env.APP_BASE_URL?.trim(),
  )
}

export function isPasswordAuthEnabled() {
  return !isGitHubOAuthEnabled() && Boolean(getConfiguredPassword())
}

export function isPasswordAuthFallbackMode() {
  return !isGitHubOAuthEnabled()
}

export function verifyPassword(password: string) {
  const configuredPassword = getConfiguredPassword()

  if (!configuredPassword) {
    return true
  }

  return safeEqual(password, configuredPassword)
}

export function getImplicitLocalSession(): AuthenticatedUser {
  return {
    id: LOCAL_OPERATOR_ID,
    login: 'local',
    name: 'Local Operator',
    email: null,
    avatarUrl: null,
    authMode: 'local',
  }
}

export function getAuthenticatedSession(request: NextRequest) {
  const explicitSession = parseSessionPayload(request.cookies.get(SESSION_COOKIE_NAME)?.value)

  if (explicitSession) {
    return explicitSession
  }

  if (isGitHubOAuthEnabled()) {
    return null
  }

  if (!getConfiguredPassword()) {
    return getImplicitLocalSession()
  }

  return null
}

export function isAuthenticatedRequest(request: NextRequest) {
  return Boolean(getAuthenticatedSession(request))
}

export function requireApiAuth(request: NextRequest) {
  return getAuthenticatedSession(request)
    ? null
    : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export function appendSessionCookie(response: NextResponse, user: AuthenticatedUser) {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    buildSignedToken(buildSessionPayload(user)),
    buildCookieOptions(Math.floor(SESSION_TTL_MS / 1000)),
  )

  return response
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, '', buildCookieOptions(0))
  return response
}

export function clearOauthStateCookie(response: NextResponse) {
  response.cookies.set(OAUTH_STATE_COOKIE_NAME, '', buildCookieOptions(0))
  return response
}

export function createOauthState() {
  const payload: OauthStatePayload = {
    state: randomUUID(),
    exp: Date.now() + OAUTH_STATE_TTL_MS,
  }

  return {
    state: payload.state,
    token: buildSignedToken(payload),
  }
}

export function appendOauthStateCookie(response: NextResponse, token: string) {
  response.cookies.set(
    OAUTH_STATE_COOKIE_NAME,
    token,
    buildCookieOptions(Math.floor(OAUTH_STATE_TTL_MS / 1000)),
  )

  return response
}

export function verifyOauthState(request: NextRequest, state: string) {
  const payload = parseOauthState(request.cookies.get(OAUTH_STATE_COOKIE_NAME)?.value)

  if (!payload) {
    return false
  }

  return safeEqual(payload.state, state)
}

export const __testing = {
  createSessionToken(user: AuthenticatedUser) {
    return buildSignedToken(buildSessionPayload(user))
  },
  parseSessionToken(rawValue: string | undefined) {
    return parseSessionPayload(rawValue)
  },
}
