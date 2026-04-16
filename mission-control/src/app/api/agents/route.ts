import { NextRequest, NextResponse } from 'next/server'
import { getAuthenticatedSession, requireApiAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'
import { getOpenClawConfigSummary } from '@/lib/openclaw-config'
import { listAgents } from '@/lib/openclaw'
import type { Department } from '@/lib/types'
import {
  createWorkspaceAgentForUser,
  deleteWorkspaceAgentForUser,
  getWorkspaceSnapshotForUser,
  updateWorkspaceAgentForUser,
} from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const [snapshot, liveAgents, config] = await Promise.all([
    getWorkspaceSnapshotForUser(session),
    listAgents().catch(() => []),
    Promise.resolve(getOpenClawConfigSummary()),
  ])

  return NextResponse.json({
    ok: true,
    agents: snapshot.agents,
    liveAgents,
    configuredAgents: config.configuredAgents,
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
      projectId?: string
      department?: Department
      name?: string
      role?: string
    }
    const snapshot = await createWorkspaceAgentForUser(session, {
      projectId: body.projectId?.trim() || '',
      department: body.department || 'builder',
      name: body.name?.trim() || '',
      role: body.role?.trim() || '',
    })

    return NextResponse.json({
      ok: true,
      agents: snapshot.agents,
    })
  } catch (error) {
    logger.warn('Workspace agent creation failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to create the agent',
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
      agentId?: string
      name?: string
      role?: string
    }

    if (!body.agentId?.trim()) {
      throw new Error('agentId is required')
    }

    const snapshot = await updateWorkspaceAgentForUser(session, {
      agentId: body.agentId.trim(),
      name: body.name,
      role: body.role,
    })

    return NextResponse.json({
      ok: true,
      agents: snapshot.agents,
    })
  } catch (error) {
    logger.warn('Workspace agent update failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to update the agent',
      },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const unauthorized = requireApiAuth(request)

  if (unauthorized) {
    return unauthorized
  }

  const session = getAuthenticatedSession(request)

  if (!session) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const agentId = request.nextUrl.searchParams.get('agentId')?.trim()

    if (!agentId) {
      throw new Error('agentId is required')
    }

    const snapshot = await deleteWorkspaceAgentForUser(session, agentId)

    return NextResponse.json({
      ok: true,
      agents: snapshot.agents,
    })
  } catch (error) {
    logger.warn('Workspace agent deletion failed', {
      error: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unable to delete the agent',
      },
      { status: 400 },
    )
  }
}
