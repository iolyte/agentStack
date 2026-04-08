import { NextRequest, NextResponse } from 'next/server'
import { sendAgentMessage } from '@/lib/openclaw'

export async function POST(req: NextRequest) {
  try {
    const { agentId, message } = await req.json()
    if (!agentId || !message) {
      return NextResponse.json({ ok: false, error: 'agentId and message required' }, { status: 400 })
    }
    const result = await sendAgentMessage(agentId, message)
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
