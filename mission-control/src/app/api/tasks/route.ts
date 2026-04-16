import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import type { TaskPriority, TaskStatus, WorkspaceTask } from '@/lib/types'
import {
  createWorkspaceTaskForUser,
  getWorkspaceSnapshotForUser,
  updateWorkspaceTaskForUser,
} from '@/lib/workspace'

export const dynamic = 'force-dynamic'

function summarizeTasks(tasks: WorkspaceTask[]) {
  return tasks.reduce(
    (summary, task) => {
      summary.total += 1

      if (task.status === 'done') {
        summary.done += 1
      } else {
        summary.open += 1
      }

      if (task.status === 'in_progress') {
        summary.inProgress += 1
      }

      if (task.status === 'blocked') {
        summary.blocked += 1
      }

      if (task.priority === 'high' && task.status !== 'done') {
        summary.highPriorityOpen += 1
      }

      return summary
    },
    {
      total: 0,
      open: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
      highPriorityOpen: 0,
    },
  )
}

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const snapshot = await getWorkspaceSnapshotForUser(session)

  return NextResponse.json({
    ok: true,
    tasks: snapshot.tasks,
    summary: summarizeTasks(snapshot.tasks),
  })
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      title?: string
      description?: string | null
      priority?: TaskPriority
      assignedAgentId?: string | null
    }
    const snapshot = await createWorkspaceTaskForUser(session, {
      title: body.title ?? '',
      description: body.description,
      priority: body.priority,
      assignedAgentId: body.assignedAgentId ?? null,
    })

    return NextResponse.json({
      ok: true,
      tasks: snapshot.tasks,
      summary: summarizeTasks(snapshot.tasks),
    })
  } catch (error) {
    logger.warn('Workspace task creation failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to create task',
      },
      { status: 400 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = (await request.json()) as {
      id?: string
      status?: TaskStatus
      priority?: TaskPriority
      assignedAgentId?: string | null
    }

    if (!body.id?.trim()) {
      throw new Error('Task id is required')
    }

    const snapshot = await updateWorkspaceTaskForUser(session, {
      id: body.id.trim(),
      status: body.status,
      priority: body.priority,
      assignedAgentId: body.assignedAgentId ?? null,
    })

    return NextResponse.json({
      ok: true,
      tasks: snapshot.tasks,
      summary: summarizeTasks(snapshot.tasks),
    })
  } catch (error) {
    logger.warn('Workspace task update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update task',
      },
      { status: 400 },
    )
  }
}
