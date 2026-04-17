import { NextRequest } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import type { WorkspaceEventEnvelope } from '@/lib/types'
import { subscribeToWorkspaceEvents } from '@/lib/workspace-events'
import { getWorkspaceSnapshotForUser, listWorkspaceEventsForUser } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

function encodeSseChunk(input: {
  event: string
  data: unknown
  id?: number
}) {
  const lines = []

  if (typeof input.id === 'number') {
    lines.push(`id: ${input.id}`)
  }

  lines.push(`event: ${input.event}`)
  lines.push(`data: ${JSON.stringify(input.data)}`)

  return `${lines.join('\n')}\n\n`
}

function parseLastEventId(request: NextRequest) {
  const rawValue = request.headers.get('last-event-id')?.trim()
    || request.nextUrl.searchParams.get('lastEventId')?.trim()

  if (!rawValue) {
    return undefined
  }

  const parsed = Number.parseInt(rawValue, 10)

  return Number.isFinite(parsed) ? parsed : undefined
}

async function writeEvent(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: unknown,
  id?: number,
) {
  await writer.write(encoder.encode(encodeSseChunk({ event, data, id })))
}

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return new Response('Unauthorized', { status: 401 })
  }

  const snapshot = await getWorkspaceSnapshotForUser(session)

  if (!snapshot.workspace) {
    return new Response('Workspace setup has not been completed yet', { status: 409 })
  }

  const workspaceId = snapshot.workspace.id
  const afterId = parseLastEventId(request)
  const backlog = await listWorkspaceEventsForUser(session, afterId)
  const encoder = new TextEncoder()
  const stream = new TransformStream()
  const writer = stream.writable.getWriter()

  let closed = false
  let closeStream = async () => {}

  const keepAlive = setInterval(() => {
    if (closed) {
      return
    }

    writer.write(encoder.encode(': keepalive\n\n')).catch(() => {
      void closeStream()
    })
  }, 15_000)

  const unsubscribe = subscribeToWorkspaceEvents(workspaceId, (event: WorkspaceEventEnvelope) => {
    if (closed) {
      return
    }

    writeEvent(writer, encoder, 'workspace-event', event, event.id).catch((error) => {
      logger.warn('Workspace event stream write failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      void closeStream()
    })
  })

  closeStream = async () => {
    if (closed) {
      unsubscribe()
      clearInterval(keepAlive)
      return
    }

    closed = true
    unsubscribe()
    clearInterval(keepAlive)

    try {
      await writer.close()
    } catch {
      // The client may disconnect while the writer is already closing.
    }
  }

  request.signal.addEventListener('abort', () => {
    void closeStream()
  })

  void (async () => {
    try {
      await writeEvent(writer, encoder, 'connected', {
        workspaceId,
        serverTime: new Date().toISOString(),
      })

      for (const event of backlog) {
        await writeEvent(writer, encoder, 'workspace-event', event, event.id)
      }
    } catch (error) {
      logger.warn('Workspace event stream bootstrap failed', {
        error: error instanceof Error ? error.message : String(error),
      })
      await closeStream()
    }
  })()

  return new Response(stream.readable, {
    headers: {
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
    },
  })
}
