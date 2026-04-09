import { NextRequest, NextResponse } from 'next/server'
import { isAuthenticatedRequest, isPasswordAuthEnabled } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return NextResponse.json({
    ok: true,
    passwordRequired: isPasswordAuthEnabled(),
    authenticated: isAuthenticatedRequest(request),
  })
}
