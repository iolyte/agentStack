import { NextResponse } from 'next/server'

export function notImplementedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'This endpoint is not available in the current agentStack build.',
    },
    { status: 501 },
  )
}
