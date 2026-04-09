import { createHmac, timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'

const SESSION_COOKIE_NAME = 'mission-control-session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

function getConfiguredPassword() {
  return process.env.MC_ADMIN_PASSWORD?.trim() || process.env.MC_PASSWORD?.trim() || null
}

function getSigningSecret() {
  return process.env.MC_SESSION_SECRET?.trim() || getConfiguredPassword() || 'clawstack'
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)

  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return timingSafeEqual(leftBuffer, rightBuffer)
}

function signValue(value: string) {
  return createHmac('sha256', getSigningSecret()).update(value).digest('hex')
}

function buildSessionValue(expiresAt: number) {
  const payload = String(expiresAt)
  return `${payload}.${signValue(payload)}`
}

function verifySessionValue(rawValue: string | undefined) {
  if (!rawValue) {
    return false
  }

  const [expiresAtRaw, signature] = rawValue.split('.')

  if (!expiresAtRaw || !signature) {
    return false
  }

  const expiresAt = Number(expiresAtRaw)

  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false
  }

  return safeEqual(signature, signValue(expiresAtRaw))
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

export function isPasswordAuthEnabled() {
  return Boolean(getConfiguredPassword())
}

export function isAuthenticatedRequest(request: NextRequest) {
  if (!isPasswordAuthEnabled()) {
    return true
  }

  return verifySessionValue(request.cookies.get(SESSION_COOKIE_NAME)?.value)
}

export function requireApiAuth(request: NextRequest) {
  return isAuthenticatedRequest(request)
    ? null
    : NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export function verifyPassword(password: string) {
  const configuredPassword = getConfiguredPassword()

  if (!configuredPassword) {
    return true
  }

  return safeEqual(password, configuredPassword)
}

export function appendSessionCookie(response: NextResponse) {
  response.cookies.set(
    SESSION_COOKIE_NAME,
    buildSessionValue(Date.now() + SESSION_TTL_MS),
    buildCookieOptions(Math.floor(SESSION_TTL_MS / 1000)),
  )

  return response
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE_NAME, '', buildCookieOptions(0))
  return response
}
