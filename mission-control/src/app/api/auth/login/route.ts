import { NextRequest, NextResponse } from 'next/server'
import { appendSessionCookie, isPasswordAuthEnabled, verifyPassword } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!isPasswordAuthEnabled()) {
    return NextResponse.json({
      ok: true,
      authenticated: true,
      passwordRequired: false,
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

  return appendSessionCookie(
    NextResponse.json({
      ok: true,
      authenticated: true,
      passwordRequired: true,
    }),
  )
}
