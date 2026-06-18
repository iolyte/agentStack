import { randomUUID } from 'node:crypto'
import { getPostgresPool } from '@/lib/postgres'
import type { MissionControlTask, TaskPriority, TaskStatus, TaskSummary } from '@/lib/types'

type McTaskRow = {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  created_at: string
  updated_at: string
  completed_at: string | null
}

function mapTask(row: McTaskRow): MissionControlTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  }
}

function normalizeStatus(value: unknown): TaskStatus {
  if (value === 'in_progress' || value === 'blocked' || value === 'done') {
    return value
  }

  return 'backlog'
}

function normalizePriority(value: unknown): TaskPriority {
  if (value === 'low' || value === 'high') {
    return value
  }

  return 'medium'
}

export function summarizeMcTasks(tasks: MissionControlTask[]): TaskSummary {
  return tasks.reduce<TaskSummary>(
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

export async function listMcTasks(showCompleted: boolean): Promise<MissionControlTask[]> {
  const pool = getPostgresPool()
  const result = await pool.query<McTaskRow>(
    `
      SELECT
        id,
        title,
        description,
        status,
        priority,
        created_at,
        updated_at,
        completed_at
      FROM amp.mc_tasks
      WHERE $1::boolean = TRUE OR status <> 'done'
      ORDER BY
        CASE priority
          WHEN 'high' THEN 0
          WHEN 'medium' THEN 1
          ELSE 2
        END,
        CASE status
          WHEN 'in_progress' THEN 0
          WHEN 'blocked' THEN 1
          WHEN 'backlog' THEN 2
          ELSE 3
        END,
        updated_at DESC
    `,
    [showCompleted],
  )

  return result.rows.map(mapTask)
}

export async function createMcTask(input: {
  title: string
  description?: string | null
  priority?: TaskPriority
}): Promise<MissionControlTask> {
  const pool = getPostgresPool()
  const title = input.title.trim()

  if (!title) {
    throw new Error('Task title is required')
  }

  const result = await pool.query<McTaskRow>(
    `
      INSERT INTO amp.mc_tasks (
        id,
        title,
        description,
        status,
        priority
      )
      VALUES ($1, $2, $3, 'backlog', $4)
      RETURNING
        id,
        title,
        description,
        status,
        priority,
        created_at,
        updated_at,
        completed_at
    `,
    [
      randomUUID(),
      title,
      input.description?.trim() || null,
      normalizePriority(input.priority),
    ],
  )

  const row = result.rows[0]

  if (!row) {
    throw new Error('Task was not created')
  }

  return mapTask(row)
}

export async function updateMcTask(input: {
  id: string
  title?: string
  description?: string | null
  status?: TaskStatus
  priority?: TaskPriority
}): Promise<MissionControlTask> {
  const pool = getPostgresPool()
  const currentResult = await pool.query<McTaskRow>(
    `
      SELECT
        id,
        title,
        description,
        status,
        priority,
        created_at,
        updated_at,
        completed_at
      FROM amp.mc_tasks
      WHERE id = $1
    `,
    [input.id],
  )

  const current = currentResult.rows[0]

  if (!current) {
    throw new Error('Task not found')
  }

  const title = input.title === undefined ? current.title : input.title.trim()

  if (!title) {
    throw new Error('Task title is required')
  }

  const status = input.status === undefined ? current.status : normalizeStatus(input.status)
  const result = await pool.query<McTaskRow>(
    `
      UPDATE amp.mc_tasks
      SET
        title = $2,
        description = $3,
        status = $4,
        priority = $5,
        updated_at = NOW(),
        completed_at = CASE
          WHEN $4 = 'done' THEN COALESCE(completed_at, NOW())
          ELSE NULL
        END
      WHERE id = $1
      RETURNING
        id,
        title,
        description,
        status,
        priority,
        created_at,
        updated_at,
        completed_at
    `,
    [
      input.id,
      title,
      input.description === undefined
        ? current.description
        : input.description?.trim() || null,
      status,
      input.priority === undefined
        ? current.priority
        : normalizePriority(input.priority),
    ],
  )

  const updated = result.rows[0]

  if (!updated) {
    throw new Error('Task not found after update')
  }

  return mapTask(updated)
}
