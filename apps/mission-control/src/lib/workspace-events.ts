import type { WorkspaceEventEnvelope } from '@/lib/types'

type WorkspaceEventListener = (event: WorkspaceEventEnvelope) => void

declare global {
  // eslint-disable-next-line no-var
  var workspaceEventListeners: Map<string, Set<WorkspaceEventListener>> | undefined
}

function getWorkspaceEventListeners() {
  if (!global.workspaceEventListeners) {
    global.workspaceEventListeners = new Map()
  }

  return global.workspaceEventListeners
}

export function subscribeToWorkspaceEvents(workspaceId: string, listener: WorkspaceEventListener) {
  const listeners = getWorkspaceEventListeners()
  const bucket = listeners.get(workspaceId) ?? new Set<WorkspaceEventListener>()

  bucket.add(listener)
  listeners.set(workspaceId, bucket)

  return () => {
    const current = listeners.get(workspaceId)

    if (!current) {
      return
    }

    current.delete(listener)

    if (current.size === 0) {
      listeners.delete(workspaceId)
    }
  }
}

export function emitWorkspaceEvent(event: WorkspaceEventEnvelope) {
  const listeners = getWorkspaceEventListeners().get(event.workspaceId)

  if (!listeners?.size) {
    return
  }

  for (const listener of [...listeners]) {
    listener(event)
  }
}
