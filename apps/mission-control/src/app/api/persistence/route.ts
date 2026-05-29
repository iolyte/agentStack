import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { inspectPersistence } from '@/lib/persistence'
import { collectStackHealth } from '@/lib/services'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const services = await collectStackHealth()
  const persistence = await inspectPersistence(services)

  return NextResponse.json({
    ok: true,
    persistence,
  })
}
