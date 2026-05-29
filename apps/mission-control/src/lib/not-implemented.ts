import { NextResponse } from 'next/server'

export function notImplementedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint is not available in the current ClawStack build.',
    },
    { status: 501 },
  )
}
