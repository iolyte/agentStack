import { NextResponse } from 'next/server'
import { listAgents } from '@/lib/openclaw'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const data = await listAgents()
    return NextResponse.json({ ok: true, agents: data?.agents ?? [] })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
