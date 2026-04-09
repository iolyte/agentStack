import { NextResponse } from 'next/server'

export function notImplementedResponse() {
  return NextResponse.json(
    {
      ok: false,
      error: 'Not implemented in Phase 1 rebuild',
    },
    { status: 501 },
  )
}
