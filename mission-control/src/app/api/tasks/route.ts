import { NextRequest, NextResponse } from 'next/server'
import { requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getDashboardPreferences } from '@/lib/preferences'
import { createMissionControlTask, listMissionControlTasks, summarizeTasks, updateMissionControlTask } from '@/lib/tasks'
import type { TaskPriority, TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const preferences = await getDashboardPreferences()
  const tasks = await listMissionControlTasks(preferences.showCompletedTasks)

  return NextResponse.json({
    ok: true,
    tasks,
    summary: summarizeTasks(tasks),
  })
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  try {
    const body = (await request.json()) as {
      title?: string
      description?: string | null
      priority?: TaskPriority
    }
    const task = await createMissionControlTask({
      title: body.title ?? '',
      description: body.description,
      priority: body.priority,
    })

    return NextResponse.json({
      ok: true,
      task,
    })
  } catch (error) {
    logger.warn('Mission Control task creation failed', {
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

  try {
    const body = (await request.json()) as {
      id?: string
      title?: string
      description?: string | null
      status?: TaskStatus
      priority?: TaskPriority
    }

    if (!body.id) {
      throw new Error('Task id is required')
    }

    const task = await updateMissionControlTask({
      id: body.id,
      title: body.title,
      description: body.description,
      status: body.status,
      priority: body.priority,
    })

    return NextResponse.json({
      ok: true,
      task,
    })
  } catch (error) {
    logger.warn('Mission Control task update failed', {
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
