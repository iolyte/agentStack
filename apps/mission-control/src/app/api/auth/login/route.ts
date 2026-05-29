import { NextRequest, NextResponse } from 'next/server'
import { appendSessionCookie, getImplicitLocalSession, isGitHubOAuthEnabled, isPasswordAuthEnabled, verifyPassword } from '@/lib/api-auth'
import { ensureLocalOperatorUser } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (isGitHubOAuthEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'GitHub OAuth is enabled for this workspace. Use GitHub sign in instead.',
      },
      { status: 400 },
    )
  }

  if (!isPasswordAuthEnabled()) {
    await ensureLocalOperatorUser()

    return NextResponse.json({
      ok: true,
      authenticated: true,
      passwordRequired: false,
      authMode: 'local',
      user: getImplicitLocalSession(),
    })
  }

  const body = (await request.json()) as { password?: string }
  const password = body.password?.trim() ?? ''

  if (!password) {
    return NextResponse.json({ ok: false, error: 'Password is required.' }, { status: 400 })
  }

  if (!verifyPassword(password)) {
    return NextResponse.json({ ok: false, error: 'Incorrect password.' }, { status: 401 })
  }

  await ensureLocalOperatorUser()

  return appendSessionCookie(
    NextResponse.json({
      ok: true,
      authenticated: true,
      passwordRequired: true,
      authMode: 'local',
      user: getImplicitLocalSession(),
    }),
    getImplicitLocalSession(),
  )
}
