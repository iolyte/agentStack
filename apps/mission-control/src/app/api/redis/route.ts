import { NextRequest } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { notImplementedResponse } from '@/lib/not-implemented'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  return notImplementedResponse()
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  return notImplementedResponse()
}
