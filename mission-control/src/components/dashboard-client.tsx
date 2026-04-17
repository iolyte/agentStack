'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  FileCode2,
  FolderTree,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  RefreshCw,
  Rocket,
  Server,
  Settings2,
  SlidersHorizontal,
} from 'lucide-react'
import type {
  AgentWorkspaceSummary,
  AppearancePreference,
  AuthMode,
  AuthenticatedUser,
  DashboardPreferences,
  DensityPreference,
  Department,
  OverviewPayload,
  PersistedChatSession,
  SetupIssue,
  TaskPriority,
  TaskStatus,
  WorkspaceAgent,
  WorkspaceEventEnvelope,
  WorkspaceMessage,
  WorkspaceSnapshot,
  WorkspaceTask,
} from '@/lib/types'

type SessionState = {
  loading: boolean
  authenticated: boolean
  passwordRequired: boolean
  oauthAvailable: boolean
  authMode: AuthMode | null
  user: AuthenticatedUser | null
  needsSetup: boolean
  workspaceId: string | null
  projectId: string | null
}

type SessionResponse = {
  ok: boolean
  authenticated: boolean
  passwordRequired: boolean
  oauthAvailable: boolean
  authMode: AuthMode | null
  user: AuthenticatedUser | null
  needsSetup: boolean
  workspaceId: string | null
  projectId: string | null
}

type WorkspaceResponse = {
  ok: boolean
  error?: string
} & WorkspaceSnapshot & {
    oauthAvailable: boolean
  }

type MessagesResponse = {
  ok: boolean
  error?: string
  messages?: WorkspaceMessage[]
}

type OpsState = {
  payload: OverviewPayload | null
  workspaceInventory: AgentWorkspaceSummary[]
  persistedSessions: PersistedChatSession[]
}

type PanelView = 'overview' | 'agents' | 'chat' | 'tasks' | 'ops' | 'settings'

const DEPARTMENT_OPTIONS: Array<{
  id: Department
  label: string
  description: string
}> = [
  { id: 'research', label: 'Research', description: 'Requirements, references, and edge cases.' },
  { id: 'builder', label: 'Builder', description: 'Implementation and delivery velocity.' },
  { id: 'designer', label: 'Designer', description: 'Interaction, UX, and interface polish.' },
  { id: 'ops', label: 'Ops', description: 'Runtime, deployment, and infrastructure safety.' },
  { id: 'qa', label: 'QA', description: 'Verification, regression checks, and release confidence.' },
  { id: 'marketing', label: 'Marketing', description: 'Story, launch framing, and messaging.' },
]

const EMPTY_TASKS: WorkspaceTask[] = []
const EMPTY_RUNS: WorkspaceSnapshot['runs'] = []
const EMPTY_TASK_EVENTS: WorkspaceSnapshot['taskEvents'] = []

function cls(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

function formatRelativeTime(value: string) {
  const delta = Date.now() - new Date(value).getTime()

  if (Number.isNaN(delta)) {
    return value
  }

  const seconds = Math.max(1, Math.floor(delta / 1000))

  if (seconds < 60) {
    return `${seconds}s ago`
  }

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }

  return `${Math.floor(hours / 24)}d ago`
}

function statusTone(status: string) {
  if (status === 'healthy' || status === 'active' || status === 'done' || status === 'working') {
    return 'tone-green'
  }

  if (status === 'warning' || status === 'degraded' || status === 'blocked' || status === 'configured') {
    return 'tone-amber'
  }

  if (status === 'critical' || status === 'down' || status === 'high') {
    return 'tone-red'
  }

  return 'tone-slate'
}

function severityLabel(issue: SetupIssue['severity']) {
  if (issue === 'critical') {
    return 'Critical'
  }

  if (issue === 'warning') {
    return 'Warning'
  }

  return 'Info'
}

function prettifyTaskStatus(status: TaskStatus) {
  if (status === 'in_progress') {
    return 'In progress'
  }

  return status.charAt(0).toUpperCase() + status.slice(1)
}

function prettifyRunStatus(status: 'running' | 'completed' | 'failed') {
  if (status === 'running') {
    return 'Running'
  }

  if (status === 'failed') {
    return 'Failed'
  }

  return 'Completed'
}

function prettifyTaskEventType(type: 'created' | 'status_changed' | 'priority_changed' | 'assignment_changed') {
  switch (type) {
    case 'created':
      return 'Created'
    case 'status_changed':
      return 'Status changed'
    case 'priority_changed':
      return 'Priority changed'
    case 'assignment_changed':
      return 'Assignment changed'
    default:
      return type
  }
}

function summarizeWorkspaceTasks(tasks: WorkspaceTask[]) {
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

      return summary
    },
    {
      total: 0,
      open: 0,
      inProgress: 0,
      blocked: 0,
      done: 0,
    },
  )
}

function ViewHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="view-header">
      <div className="eyebrow">{eyebrow}</div>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  )
}

export default function DashboardClient() {
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authenticated: false,
    passwordRequired: true,
    oauthAvailable: false,
    authMode: null,
    user: null,
    needsSetup: false,
    workspaceId: null,
    projectId: null,
  })
  const [activeView, setActiveView] = useState<PanelView>('overview')
  const [workspace, setWorkspace] = useState<WorkspaceResponse | null>(null)
  const [ops, setOps] = useState<OpsState>({
    payload: null,
    workspaceInventory: [],
    persistedSessions: [],
  })
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [messagesByAgent, setMessagesByAgent] = useState<Record<string, WorkspaceMessage[]>>({})
  const [password, setPassword] = useState('')
  const [goal, setGoal] = useState('')
  const [selectedDepartments, setSelectedDepartments] = useState<Department[]>(['research', 'builder', 'qa'])
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium')
  const [taskAgentId, setTaskAgentId] = useState<string>('')
  const [chatDraft, setChatDraft] = useState('')
  const [newAgentName, setNewAgentName] = useState('')
  const [newAgentRole, setNewAgentRole] = useState('')
  const [newAgentDepartment, setNewAgentDepartment] = useState<Department>('builder')
  const [settings, setSettings] = useState<DashboardPreferences | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [chatError, setChatError] = useState<string | null>(null)
  const [agentError, setAgentError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [bootstrapping, setBootstrapping] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [sendingMessage, setSendingMessage] = useState(false)
  const [creatingAgent, setCreatingAgent] = useState(false)
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const [realtimeConnected, setRealtimeConnected] = useState(false)
  const [lastRealtimeEventAt, setLastRealtimeEventAt] = useState<string | null>(null)
  const realtimeRefreshTimeoutRef = useRef<number | null>(null)
  const pendingOpsRealtimeRefreshRef = useRef(false)

  const refreshSeconds = ops.payload?.preferences.refreshIntervalSeconds ?? 15
  const agents = workspace?.agents ?? []
  const tasks = workspace?.tasks ?? EMPTY_TASKS
  const runs = workspace?.runs ?? EMPTY_RUNS
  const taskEvents = workspace?.taskEvents ?? EMPTY_TASK_EVENTS
  const taskSummary = useMemo(() => summarizeWorkspaceTasks(tasks), [tasks])
  const activeRuns = useMemo(() => runs.filter((run) => run.status === 'running'), [runs])
  const selectedAgent = agents.find((agent) => agent.id === selectedAgentId) ?? agents[0] ?? null
  const selectedMessages = selectedAgent ? messagesByAgent[selectedAgent.id] ?? [] : []

  const loadSession = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' })
      const data = (await response.json()) as SessionResponse

      startTransition(() => {
        setSession({
          loading: false,
          authenticated: data.authenticated,
          passwordRequired: data.passwordRequired,
          oauthAvailable: data.oauthAvailable,
          authMode: data.authMode,
          user: data.user,
          needsSetup: data.needsSetup,
          workspaceId: data.workspaceId,
          projectId: data.projectId,
        })
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load the session.')
      setSession((current) => ({
        ...current,
        loading: false,
        authenticated: false,
        workspaceId: null,
        projectId: null,
      }))
    }
  }, [])

  const loadWorkspace = useCallback(async (agentId?: string) => {
    const search = agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
    const response = await fetch(`/api/workspace${search}`, { cache: 'no-store' })

    if (response.status === 401) {
      setWorkspace(null)
      setSession((current) => ({
        ...current,
        authenticated: false,
        workspaceId: null,
        projectId: null,
      }))
      return null
    }

    const data = (await response.json()) as WorkspaceResponse

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Unable to load the workspace.')
    }

    startTransition(() => {
      setWorkspace(data)
      setSession((current) => ({
        ...current,
        needsSetup: data.needsSetup,
        user: data.user,
        authMode: data.authMode,
        workspaceId: data.workspace?.id ?? null,
        projectId: data.project?.id ?? null,
      }))
    })

    const nextMessages = data.messages.reduce<Record<string, WorkspaceMessage[]>>((accumulator, message) => {
      accumulator[message.agentId] = [...(accumulator[message.agentId] || []), message]
      return accumulator
    }, {})

    setMessagesByAgent((current) => ({
      ...current,
      ...nextMessages,
    }))

    return data
  }, [])

  const loadOps = useCallback(async () => {
    const [response, agentFilesResponse, chatResponse] = await Promise.all([
      fetch('/api/control-center', { cache: 'no-store' }),
      fetch('/api/agent-files', { cache: 'no-store' }),
      fetch('/api/chat', { cache: 'no-store' }),
    ])

    if (response.status === 401) {
      setSession((current) => ({
        ...current,
        authenticated: false,
      }))
      return
    }

    const overview = (await response.json()) as OverviewPayload & { error?: string }

    if (!response.ok) {
      throw new Error(overview.error || 'Unable to load operations data.')
    }

    let workspaceInventory: AgentWorkspaceSummary[] = []
    let persistedSessions: PersistedChatSession[] = []

    if (agentFilesResponse.ok) {
      const agentFiles = (await agentFilesResponse.json()) as {
        ok: boolean
        agents?: AgentWorkspaceSummary[]
      }

      if (agentFiles.ok && Array.isArray(agentFiles.agents)) {
        workspaceInventory = agentFiles.agents
      }
    }

    if (chatResponse.ok) {
      const chatPayload = (await chatResponse.json()) as {
        ok: boolean
        persistedSessions?: PersistedChatSession[]
      }

      if (chatPayload.ok && Array.isArray(chatPayload.persistedSessions)) {
        persistedSessions = chatPayload.persistedSessions
      }
    }

    startTransition(() => {
      setOps({
        payload: overview,
        workspaceInventory,
        persistedSessions,
      })
      setSettings(overview.preferences)
      setError(null)
    })
  }, [])

  const scheduleRealtimeRefresh = useCallback((includeOps: boolean) => {
    if (includeOps) {
      pendingOpsRealtimeRefreshRef.current = true
    }

    if (realtimeRefreshTimeoutRef.current) {
      return
    }

    realtimeRefreshTimeoutRef.current = window.setTimeout(async () => {
      realtimeRefreshTimeoutRef.current = null
      const refreshOps = pendingOpsRealtimeRefreshRef.current
      pendingOpsRealtimeRefreshRef.current = false

      try {
        await loadWorkspace(selectedAgentId ?? undefined)

        if (refreshOps) {
          await loadOps()
        }
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to refresh ClawStack.')
      }
    }, 250)
  }, [loadOps, loadWorkspace, selectedAgentId])

  const refreshAll = useCallback(async () => {
    setRefreshing(true)

    try {
      const workspaceData = await loadWorkspace(selectedAgentId ?? undefined)
      await loadOps()

      if (!selectedAgentId && workspaceData?.agents.length) {
        const preferred = workspaceData.agents.find((agent) => agent.isCore) || workspaceData.agents[0]
        setSelectedAgentId(preferred.id)
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to refresh ClawStack.')
    } finally {
      setRefreshing(false)
    }
  }, [loadOps, loadWorkspace, selectedAgentId])

  useEffect(() => {
    loadSession()
  }, [loadSession])

  useEffect(() => {
    return () => {
      if (realtimeRefreshTimeoutRef.current) {
        window.clearTimeout(realtimeRefreshTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!session.authenticated) {
      return
    }

    refreshAll()
  }, [refreshAll, session.authenticated])

  useEffect(() => {
    if (!session.authenticated) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (realtimeConnected) {
        loadOps().catch((requestError) => {
          setError(requestError instanceof Error ? requestError.message : 'Unable to refresh ClawStack.')
        })
        return
      }

      refreshAll()
    }, refreshSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [loadOps, realtimeConnected, refreshAll, refreshSeconds, session.authenticated])

  useEffect(() => {
    if (!session.authenticated || !workspace?.workspace?.id || workspace.needsSetup) {
      setRealtimeConnected(false)
      return
    }

    const eventSource = new EventSource('/api/events')

    const handleConnected = () => {
      setRealtimeConnected(true)
    }

    const handleRealtimeEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as WorkspaceEventEnvelope
        setLastRealtimeEventAt(payload.createdAt)
        scheduleRealtimeRefresh(payload.entityType !== 'message')
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : 'Unable to parse the realtime update.')
      }
    }

    const handleError = () => {
      setRealtimeConnected(false)
    }

    eventSource.addEventListener('connected', handleConnected)
    eventSource.addEventListener('workspace-event', handleRealtimeEvent as EventListener)
    eventSource.onerror = handleError
    eventSource.onopen = handleConnected

    return () => {
      eventSource.removeEventListener('connected', handleConnected)
      eventSource.removeEventListener('workspace-event', handleRealtimeEvent as EventListener)
      eventSource.close()
      setRealtimeConnected(false)
    }
  }, [scheduleRealtimeRefresh, session.authenticated, workspace?.needsSetup, workspace?.workspace?.id])

  useEffect(() => {
    if (!selectedAgentId || !session.authenticated || !workspace || workspace.needsSetup) {
      return
    }

    if (messagesByAgent[selectedAgentId]?.length) {
      return
    }

    setLoadingMessages(true)
    fetch(`/api/messages?agentId=${encodeURIComponent(selectedAgentId)}`, {
      cache: 'no-store',
    })
      .then(async (response) => {
        const data = (await response.json()) as MessagesResponse

        if (!response.ok || !data.ok || !Array.isArray(data.messages)) {
          throw new Error(data.error || 'Unable to load messages.')
        }

        setMessagesByAgent((current) => ({
          ...current,
          [selectedAgentId]: data.messages || [],
        }))
      })
      .catch((requestError) => {
        setChatError(requestError instanceof Error ? requestError.message : 'Unable to load messages.')
      })
      .finally(() => {
        setLoadingMessages(false)
      })
  }, [messagesByAgent, selectedAgentId, session.authenticated, workspace])

  useEffect(() => {
    if (!workspace?.agents.length) {
      setSelectedAgentId(null)
      return
    }

    if (selectedAgentId && workspace.agents.some((agent) => agent.id === selectedAgentId)) {
      return
    }

    const preferred = workspace.agents.find((agent) => agent.isCore) || workspace.agents[0]
    setSelectedAgentId(preferred.id)
  }, [selectedAgentId, workspace?.agents])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError(null)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      })
      const data = (await response.json()) as {
        ok: boolean
        error?: string
      }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to sign in.')
      }

      setPassword('')
      await loadSession()
    } catch (requestError) {
      setLoginError(requestError instanceof Error ? requestError.message : 'Unable to sign in.')
    }
  }

  function handleGitHubLogin() {
    window.location.href = '/api/auth/github/start'
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setWorkspace(null)
    setOps({
      payload: null,
      workspaceInventory: [],
      persistedSessions: [],
    })
    setRealtimeConnected(false)
    setLastRealtimeEventAt(null)
    setMessagesByAgent({})
    setSelectedAgentId(null)
    await loadSession()
  }

  async function handleSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSetupError(null)
    setBootstrapping(true)

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          goal,
          departments: selectedDepartments,
        }),
      })
      const data = (await response.json()) as WorkspaceResponse

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to initialize the workspace.')
      }

      setWorkspace(data)
      setGoal('')
      setSetupError(null)
      setSession((current) => ({
        ...current,
        needsSetup: false,
        workspaceId: data.workspace?.id ?? null,
        projectId: data.project?.id ?? null,
      }))
      const preferred = data.agents.find((agent) => agent.isCore) || data.agents[0] || null
      setSelectedAgentId(preferred?.id || null)
      await loadOps()
    } catch (requestError) {
      setSetupError(requestError instanceof Error ? requestError.message : 'Unable to initialize the workspace.')
    } finally {
      setBootstrapping(false)
    }
  }

  async function savePreferences(nextSettings: Partial<DashboardPreferences>) {
    if (!settings) {
      return
    }

    setSavingSettings(true)
    setSettingsError(null)

    try {
      const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(nextSettings),
      })
      const data = (await response.json()) as {
        ok: boolean
        error?: string
        preferences?: DashboardPreferences
      }

      if (!response.ok || !data.ok || !data.preferences) {
        throw new Error(data.error || 'Unable to update preferences.')
      }

      setSettings(data.preferences)
      await loadOps()
    } catch (requestError) {
      setSettingsError(requestError instanceof Error ? requestError.message : 'Unable to update preferences.')
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setTaskError(null)

    if (!taskTitle.trim()) {
      setTaskError('Task title is required.')
      return
    }

    setCreatingTask(true)

    try {
      const response = await fetch('/api/tasks', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: taskTitle,
          description: taskDescription,
          priority: taskPriority,
          assignedAgentId: taskAgentId || null,
        }),
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to create the task.')
      }

      setTaskTitle('')
      setTaskDescription('')
      setTaskPriority('medium')
      setTaskAgentId('')
      await loadWorkspace(selectedAgentId ?? undefined)
    } catch (requestError) {
      setTaskError(requestError instanceof Error ? requestError.message : 'Unable to create the task.')
    } finally {
      setCreatingTask(false)
    }
  }

  async function updateTask(task: WorkspaceTask, patch: Partial<WorkspaceTask>) {
    setUpdatingTaskId(task.id)
    setTaskError(null)

    try {
      const response = await fetch('/api/tasks', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: task.id,
          status: patch.status ?? task.status,
          priority: patch.priority ?? task.priority,
          assignedAgentId: patch.assignedAgentId ?? task.assignedAgentId,
        }),
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to update the task.')
      }

      await loadWorkspace(selectedAgentId ?? undefined)
    } catch (requestError) {
      setTaskError(requestError instanceof Error ? requestError.message : 'Unable to update the task.')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setChatError(null)

    if (!selectedAgent || !chatDraft.trim()) {
      setChatError('Choose an agent and enter a message to continue.')
      return
    }

    setSendingMessage(true)

    try {
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          agentId: selectedAgent.id,
          content: chatDraft,
        }),
      })
      const data = (await response.json()) as MessagesResponse

      if (!response.ok || !data.ok || !Array.isArray(data.messages)) {
        throw new Error(data.error || 'Unable to send the message.')
      }

      setMessagesByAgent((current) => ({
        ...current,
        [selectedAgent.id]: data.messages || [],
      }))
      setChatDraft('')
      await loadWorkspace(selectedAgent.id)
    } catch (requestError) {
      setChatError(requestError instanceof Error ? requestError.message : 'Unable to send the message.')
    } finally {
      setSendingMessage(false)
    }
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAgentError(null)

    if (!workspace?.project) {
      setAgentError('Finish setup before adding more agents.')
      return
    }

    if (!newAgentName.trim() || !newAgentRole.trim()) {
      setAgentError('Name and role are required.')
      return
    }

    setCreatingAgent(true)

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          projectId: workspace.project.id,
          department: newAgentDepartment,
          name: newAgentName,
          role: newAgentRole,
        }),
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to create the agent.')
      }

      setNewAgentName('')
      setNewAgentRole('')
      setNewAgentDepartment('builder')
      await loadWorkspace(selectedAgentId ?? undefined)
      await loadOps()
    } catch (requestError) {
      setAgentError(requestError instanceof Error ? requestError.message : 'Unable to create the agent.')
    } finally {
      setCreatingAgent(false)
    }
  }

  async function handleDeleteAgent(agentId: string) {
    setDeletingAgentId(agentId)
    setAgentError(null)

    try {
      const response = await fetch(`/api/agents?agentId=${encodeURIComponent(agentId)}`, {
        method: 'DELETE',
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to delete the agent.')
      }

      setMessagesByAgent((current) => {
        const next = { ...current }
        delete next[agentId]
        return next
      })
      await loadWorkspace(selectedAgentId === agentId ? undefined : selectedAgentId ?? undefined)
      await loadOps()
    } catch (requestError) {
      setAgentError(requestError instanceof Error ? requestError.message : 'Unable to delete the agent.')
    } finally {
      setDeletingAgentId(null)
    }
  }

  function toggleDepartment(department: Department) {
    setSelectedDepartments((current) => (
      current.includes(department)
        ? current.filter((entry) => entry !== department)
        : [...current, department]
    ))
  }

  if (session.loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="eyebrow">ClawStack</div>
          <h1>Loading the workspace</h1>
          <p>Connecting your AI agent management platform, operational telemetry, and workspace state.</p>
        </section>
      </main>
    )
  }

  if (!session.authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="eyebrow">ClawStack</div>
          <h1>Sign in to Mission Control</h1>
          <p>ClawStack is a local-first AI agent management platform. Sign in to open your workspace and operator tools.</p>

          {session.oauthAvailable ? (
            <div className="auth-actions">
              <button className="primary-button" onClick={handleGitHubLogin} type="button">
                <Rocket size={16} />
                Continue with GitHub
              </button>
            </div>
          ) : null}

          {session.passwordRequired ? (
            <form className="auth-form" onSubmit={handleLogin}>
              <input
                autoComplete="current-password"
                className="field"
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Mission Control password"
                type="password"
                value={password}
              />
              <button className="primary-button" type="submit">
                Sign in
              </button>
            </form>
          ) : null}

          {loginError ? <p className="error-copy">{loginError}</p> : null}
          {error ? <p className="error-copy">{error}</p> : null}
        </section>
      </main>
    )
  }

  if (session.needsSetup || workspace?.needsSetup) {
    return (
      <main className="auth-shell">
        <section className="auth-card setup-card">
          <div className="eyebrow">ClawStack</div>
          <h1>Initialize your workspace</h1>
          <p>Define the goal, choose the departments you want online, and ClawStack will bootstrap the first agent team and work queue.</p>

          <form className="setup-form" onSubmit={handleSetup}>
            <label className="setup-block">
              <span className="metric-label">What are we building?</span>
              <textarea
                className="field text-area"
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Example: Build a local-first AI operating system for product, engineering, and launch work."
                rows={5}
                value={goal}
              />
            </label>

            <div className="setup-block">
              <span className="metric-label">Team departments</span>
              <div className="department-grid">
                {DEPARTMENT_OPTIONS.map((department) => (
                  <button
                    className={cls('department-chip', selectedDepartments.includes(department.id) && 'department-chip-active')}
                    key={department.id}
                    onClick={() => toggleDepartment(department.id)}
                    type="button"
                  >
                    <strong>{department.label}</strong>
                    <small>{department.description}</small>
                  </button>
                ))}
              </div>
            </div>

            <button className="primary-button" disabled={bootstrapping} type="submit">
              {bootstrapping ? 'Bootstrapping workspace…' : 'Create workspace'}
              <ChevronRight size={16} />
            </button>
          </form>

          {setupError ? <p className="error-copy">{setupError}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main
      className={cls(
        'admin-shell',
        settings?.densityPreference === 'compact' && 'compact-density',
        settings?.appearancePreference === 'light' && 'appearance-light',
        settings?.appearancePreference === 'dark' && 'appearance-dark',
      )}
    >
      <aside className="admin-sidebar">
        <div>
          <div className="brand-mark">ClawStack</div>
          <h1>Mission Control</h1>
          <p>Workspace orchestration for agents, tasks, conversations, and the stack that runs them.</p>
        </div>

        <nav className="nav-stack">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'agents', label: 'Agents', icon: Bot },
            { id: 'chat', label: 'Chat', icon: MessagesSquare },
            { id: 'tasks', label: 'Tasks', icon: ListTodo },
            { id: 'ops', label: 'Ops', icon: Server },
            { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
          ].map((item) => {
            const Icon = item.icon

            return (
              <button
                className={cls('nav-item', activeView === item.id && 'nav-item-active')}
                key={item.id}
                onClick={() => setActiveView(item.id as PanelView)}
                type="button"
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="sidebar-note">
          <div className="eyebrow">Platform</div>
          <p>ClawStack is building toward a full AI Agent Management Platform while staying local-first and operator-friendly.</p>
        </div>
      </aside>

      <section className="admin-main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Workspace</div>
            <h2>{workspace?.workspace?.name || 'ClawStack Workspace'}</h2>
            <p>{workspace?.workspace?.goal || 'Local-first coordination for agent teams, tasks, and runtime operations.'}</p>
          </div>
          <div className="topbar-actions">
            <div className="user-badge">
              <strong>{session.user?.name || 'Operator'}</strong>
              <small>{session.authMode === 'github' ? `@${session.user?.login}` : 'Local operator'}</small>
            </div>
            <div className="user-badge">
              <strong>{realtimeConnected ? 'Realtime connected' : 'Realtime offline'}</strong>
              <small>{lastRealtimeEventAt ? `Last update ${formatRelativeTime(lastRealtimeEventAt)}` : 'Waiting for workspace events'}</small>
            </div>
            <button className="secondary-button" onClick={() => refreshAll()} type="button">
              <RefreshCw size={16} className={cls(refreshing && 'spin')} />
              Refresh
            </button>
            <button className="secondary-button" onClick={handleLogout} type="button">
              Sign out
            </button>
          </div>
        </header>

        <section className="metric-strip">
          <article className="metric-card">
            <span className="metric-label">Agents online</span>
            <strong>{agents.length}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Open tasks</span>
            <strong>{taskSummary.open}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Conversations</span>
            <strong>{Object.values(messagesByAgent).reduce((sum, list) => sum + list.length, 0)}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Active runs</span>
            <strong>{activeRuns.length}</strong>
          </article>
          <article className="metric-card">
            <span className="metric-label">Healthy services</span>
            <strong>
              {ops.payload ? `${ops.payload.services.filter((service) => service.status === 'healthy').length}/${ops.payload.services.length}` : '…'}
            </strong>
          </article>
        </section>

        {error ? (
          <section className="panel panel-alert">
            <AlertTriangle size={16} />
            <div>
              <strong>Refresh problem</strong>
              <p>{error}</p>
            </div>
          </section>
        ) : null}

        {activeView === 'overview' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Overview"
              title="Workspace posture"
              description="A single view of the current goal, active team, task pressure, and operations health."
            />

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Current project</h3>
                  <Rocket size={16} />
                </div>
                <div className="list-stack">
                  <div className="list-row">
                    <div>
                      <strong>{workspace?.project?.name || 'Primary Project'}</strong>
                      <p>{workspace?.project?.description || 'The first project will evolve as the core planner refines the workspace.'}</p>
                      <small>{workspace?.workspace?.goal || 'No workspace goal recorded.'}</small>
                    </div>
                    <span className="status-pill tone-slate">{agents.length} agents</span>
                  </div>
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Execution summary</h3>
                  <ListTodo size={16} />
                </div>
                <div className="metric-strip nested-strip">
                  <article className="metric-card">
                    <span className="metric-label">Open</span>
                    <strong>{taskSummary.open}</strong>
                  </article>
                  <article className="metric-card">
                    <span className="metric-label">In progress</span>
                    <strong>{taskSummary.inProgress}</strong>
                  </article>
                  <article className="metric-card">
                    <span className="metric-label">Blocked</span>
                    <strong>{taskSummary.blocked}</strong>
                  </article>
                </div>
              </article>
            </section>

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Agent roster</h3>
                  <Bot size={16} />
                </div>
                <div className="list-stack">
                  {agents.map((agent) => (
                    <div className="list-row" key={agent.id}>
                      <div>
                        <strong>{agent.name}</strong>
                        <p>{agent.department} · {agent.role}</p>
                        <small>{agent.model || 'No live model detected'} · {agent.sessions} sessions</small>
                      </div>
                      <span className={cls('status-pill', statusTone(agent.status))}>{agent.status}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Latest work items</h3>
                  <CheckCircle2 size={16} />
                </div>
                <div className="list-stack">
                  {tasks.slice(0, 5).map((task) => (
                    <div className="list-row" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <p>{task.description || 'No additional notes recorded.'}</p>
                        <small>{task.assignedAgentName || 'Unassigned'} · updated {formatRelativeTime(task.updatedAt)}</small>
                      </div>
                      <span className={cls('status-pill', statusTone(task.status))}>{prettifyTaskStatus(task.status)}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Recent runs</h3>
                  <MessagesSquare size={16} />
                </div>
                <div className="list-stack">
                  {runs.length > 0 ? runs.slice(0, 5).map((run) => (
                    <div className="list-row" key={run.id}>
                      <div>
                        <strong>{agents.find((agent) => agent.id === run.agentId)?.name || 'Agent run'}</strong>
                        <p>{run.responseExcerpt || run.promptExcerpt || 'No run excerpts recorded yet.'}</p>
                        <small>{formatRelativeTime(run.updatedAt)} · {run.sessionKey}</small>
                      </div>
                      <span className={cls('status-pill', statusTone(run.status === 'completed' ? 'healthy' : run.status === 'failed' ? 'critical' : 'active'))}>
                        {prettifyRunStatus(run.status)}
                      </span>
                    </div>
                  )) : (
                    <p className="empty-copy">No runs have been recorded yet. Agent messages will appear here once execution starts.</p>
                  )}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Task activity</h3>
                  <RefreshCw size={16} />
                </div>
                <div className="list-stack">
                  {taskEvents.length > 0 ? taskEvents.slice(0, 6).map((taskEvent) => {
                    const taskTitle = tasks.find((task) => task.id === taskEvent.taskId)?.title || 'Task update'

                    return (
                      <div className="list-row" key={taskEvent.id}>
                        <div>
                          <strong>{taskTitle}</strong>
                          <p>{prettifyTaskEventType(taskEvent.type)}</p>
                          <small>{formatRelativeTime(taskEvent.createdAt)}</small>
                        </div>
                        <span className="status-pill tone-slate">{prettifyTaskEventType(taskEvent.type)}</span>
                      </div>
                    )
                  }) : (
                    <p className="empty-copy">Task creation and status changes will be tracked here once the queue starts moving.</p>
                  )}
                </div>
              </article>
            </section>
          </div>
        ) : null}

        {activeView === 'agents' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Agents"
              title="Team management"
              description="Shape the agent roster, inspect live status, and extend the team for new departments or workflows."
            />

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Create agent</h3>
                  <Bot size={16} />
                </div>
                <form className="task-form" onSubmit={handleCreateAgent}>
                  <div className="form-row">
                    <select
                      className="field"
                      onChange={(event) => setNewAgentDepartment(event.target.value as Department)}
                      value={newAgentDepartment}
                    >
                      {DEPARTMENT_OPTIONS.map((department) => (
                        <option key={department.id} value={department.id}>
                          {department.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="field"
                      onChange={(event) => setNewAgentName(event.target.value)}
                      placeholder="Agent name"
                      value={newAgentName}
                    />
                  </div>
                  <textarea
                    className="field text-area"
                    onChange={(event) => setNewAgentRole(event.target.value)}
                    placeholder="Role and operating brief"
                    rows={4}
                    value={newAgentRole}
                  />
                  <button className="primary-button" disabled={creatingAgent} type="submit">
                    {creatingAgent ? 'Creating…' : 'Add agent'}
                  </button>
                </form>
                {agentError ? <p className="error-copy">{agentError}</p> : null}
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Current roster</h3>
                  <FolderTree size={16} />
                </div>
                <div className="list-stack">
                  {agents.map((agent) => (
                    <div className="list-row" key={agent.id}>
                      <div>
                        <strong>{agent.name}</strong>
                        <p>{agent.department} · {agent.role}</p>
                        <small>{agent.workspacePath}</small>
                      </div>
                      <div className="list-meta">
                        <span className={cls('status-pill', statusTone(agent.status))}>{agent.status}</span>
                        {!agent.isCore ? (
                          <button
                            className="secondary-button"
                            disabled={deletingAgentId === agent.id}
                            onClick={() => handleDeleteAgent(agent.id)}
                            type="button"
                          >
                            {deletingAgentId === agent.id ? 'Removing…' : 'Remove'}
                          </button>
                        ) : (
                          <small>Core planner</small>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </div>
        ) : null}

        {activeView === 'chat' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Chat"
              title="Agent conversations"
              description="Send scoped instructions to one agent at a time and keep the transcript tied to the workspace."
            />

            <section className="chat-shell">
              <aside className="chat-sidebar panel">
                <div className="panel-header">
                  <h3>Available agents</h3>
                  <MessagesSquare size={16} />
                </div>
                <div className="list-stack">
                  {agents.map((agent) => (
                    <button
                      className={cls('chat-agent-row', selectedAgent?.id === agent.id && 'chat-agent-row-active')}
                      key={agent.id}
                      onClick={() => setSelectedAgentId(agent.id)}
                      type="button"
                    >
                      <strong>{agent.name}</strong>
                      <small>{agent.department} · {agent.model || 'No live model detected'}</small>
                    </button>
                  ))}
                </div>
              </aside>

              <section className="panel chat-panel">
                <div className="panel-header">
                  <h3>{selectedAgent?.name || 'Choose an agent'}</h3>
                  <span className={cls('status-pill', statusTone(selectedAgent?.status || 'configured'))}>
                    {selectedAgent?.status || 'idle'}
                  </span>
                </div>

                <div className="message-stream">
                  {loadingMessages ? <p className="empty-copy">Loading conversation…</p> : null}
                  {!loadingMessages && selectedMessages.length === 0 ? (
                    <p className="empty-copy">No messages yet. Start the conversation with a concrete instruction.</p>
                  ) : null}
                  {selectedMessages.map((message) => (
                    <article
                      className={cls('message-bubble', message.role === 'user' ? 'message-bubble-user' : 'message-bubble-agent')}
                      key={message.id}
                    >
                      <span className="metric-label">{message.role === 'user' ? 'You' : selectedAgent?.name || 'Agent'}</span>
                      <p>{message.content}</p>
                      <small>{formatRelativeTime(message.createdAt)}</small>
                    </article>
                  ))}
                </div>

                <form className="task-form" onSubmit={handleSendMessage}>
                  <textarea
                    className="field text-area"
                    onChange={(event) => setChatDraft(event.target.value)}
                    placeholder={selectedAgent ? `Message ${selectedAgent.name}` : 'Choose an agent to start chatting'}
                    rows={4}
                    value={chatDraft}
                  />
                  <button className="primary-button" disabled={!selectedAgent || sendingMessage} type="submit">
                    {sendingMessage ? 'Sending…' : 'Send message'}
                  </button>
                </form>
                {chatError ? <p className="error-copy">{chatError}</p> : null}
              </section>
            </section>
          </div>
        ) : null}

        {activeView === 'tasks' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Tasks"
              title="Execution board"
              description="Track planning output, assign work to agents, and keep the next deliverables visible."
            />

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Create task</h3>
                  <ListTodo size={16} />
                </div>
                <form className="task-form" onSubmit={handleCreateTask}>
                  <input
                    className="field"
                    onChange={(event) => setTaskTitle(event.target.value)}
                    placeholder="Add a new task"
                    value={taskTitle}
                  />
                  <textarea
                    className="field text-area"
                    onChange={(event) => setTaskDescription(event.target.value)}
                    placeholder="Describe the expected outcome or handoff notes"
                    rows={4}
                    value={taskDescription}
                  />
                  <div className="form-row">
                    <select
                      className="field"
                      onChange={(event) => setTaskPriority(event.target.value as TaskPriority)}
                      value={taskPriority}
                    >
                      <option value="low">Low priority</option>
                      <option value="medium">Medium priority</option>
                      <option value="high">High priority</option>
                    </select>
                    <select
                      className="field"
                      onChange={(event) => setTaskAgentId(event.target.value)}
                      value={taskAgentId}
                    >
                      <option value="">Unassigned</option>
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button className="primary-button" disabled={creatingTask} type="submit">
                    {creatingTask ? 'Saving…' : 'Create task'}
                  </button>
                </form>
                {taskError ? <p className="error-copy">{taskError}</p> : null}
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Queue summary</h3>
                  <Settings2 size={16} />
                </div>
                <div className="metric-strip nested-strip">
                  <article className="metric-card">
                    <span className="metric-label">Open</span>
                    <strong>{taskSummary.open}</strong>
                  </article>
                  <article className="metric-card">
                    <span className="metric-label">Done</span>
                    <strong>{taskSummary.done}</strong>
                  </article>
                  <article className="metric-card">
                    <span className="metric-label">Blocked</span>
                    <strong>{taskSummary.blocked}</strong>
                  </article>
                </div>
              </article>
            </section>

            <section className="panel">
              <div className="panel-header">
                <h3>Tracked tasks</h3>
              </div>
              <div className="list-stack">
                {tasks.length > 0 ? (
                  tasks.map((task) => (
                    <div className="list-row task-row" key={task.id}>
                      <div>
                        <strong>{task.title}</strong>
                        <p>{task.description || 'No task notes yet.'}</p>
                        <small>{task.assignedAgentName || 'Unassigned'} · updated {formatRelativeTime(task.updatedAt)}</small>
                      </div>
                      <div className="task-controls">
                        <select
                          className="field control-field"
                          disabled={updatingTaskId === task.id}
                          onChange={(event) => updateTask(task, { status: event.target.value as TaskStatus })}
                          value={task.status}
                        >
                          <option value="backlog">Backlog</option>
                          <option value="in_progress">In progress</option>
                          <option value="blocked">Blocked</option>
                          <option value="done">Done</option>
                        </select>
                        <select
                          className="field control-field"
                          disabled={updatingTaskId === task.id}
                          onChange={(event) => updateTask(task, { priority: event.target.value as TaskPriority })}
                          value={task.priority}
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                        </select>
                        <select
                          className="field control-field"
                          disabled={updatingTaskId === task.id}
                          onChange={(event) => updateTask(task, { assignedAgentId: event.target.value || null })}
                          value={task.assignedAgentId || ''}
                        >
                          <option value="">Unassigned</option>
                          {agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                        <span className={cls('status-pill', statusTone(task.status))}>{prettifyTaskStatus(task.status)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No tasks yet. The setup wizard and task form will populate the first backlog.</p>
                )}
              </div>
            </section>
          </div>
        ) : null}

        {activeView === 'ops' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Ops"
              title="Runtime and infrastructure"
              description="Keep ClawStack healthy by watching services, persistence, configuration, and saved session state."
            />

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Service health</h3>
                  <Activity size={16} />
                </div>
                <div className="list-stack">
                  {ops.payload?.services.map((service) => (
                    <div className="list-row" key={service.name}>
                      <div>
                        <strong>{service.name}</strong>
                        <p>{service.details || 'Latest health probe succeeded.'}</p>
                      </div>
                      <div className="list-meta">
                        <span className={cls('status-pill', statusTone(service.status))}>{service.status}</span>
                        <small>{service.latency ? `${service.latency} ms` : 'n/a'}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Setup issues</h3>
                  <AlertTriangle size={16} />
                </div>
                <div className="list-stack">
                  {ops.payload?.setupIssues.map((issue) => (
                    <div className="list-row" key={issue.id}>
                      <div>
                        <strong>{issue.title}</strong>
                        <p>{issue.details}</p>
                        <small>{issue.action}</small>
                      </div>
                      <span className={cls('status-pill', statusTone(issue.severity))}>{severityLabel(issue.severity)}</span>
                    </div>
                  ))}
                </div>
              </article>
            </section>

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Persistence</h3>
                  <Server size={16} />
                </div>
                <div className="list-stack">
                  {ops.payload?.persistence.map((store) => (
                    <div className="list-row" key={store.id}>
                      <div>
                        <strong>{store.label}</strong>
                        <p>{store.details}</p>
                      </div>
                      <div className="list-meta">
                        <span className={cls('status-pill', statusTone(store.status))}>{store.status}</span>
                        <small>{store.mounted ? 'mounted' : 'missing'}</small>
                      </div>
                    </div>
                  ))}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>OpenClaw config</h3>
                  <FileCode2 size={16} />
                </div>
                {ops.payload ? (
                  <dl className="detail-grid">
                    <div>
                      <dt>Path</dt>
                      <dd>{ops.payload.openclawConfig.path}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{ops.payload.openclawConfig.valid ? 'Valid JSON' : 'Needs review'}</dd>
                    </div>
                    <div>
                      <dt>Configured agents</dt>
                      <dd>{ops.payload.openclawConfig.configuredAgents.length}</dd>
                    </div>
                    <div>
                      <dt>Allowed origins</dt>
                      <dd>{ops.payload.openclawConfig.allowedOrigins.length || 'None declared'}</dd>
                    </div>
                  </dl>
                ) : (
                  <p className="empty-copy">Operations data is loading…</p>
                )}
              </article>
            </section>

            <section className="content-grid two-column">
              <article className="panel">
                <div className="panel-header">
                  <h3>Persisted workspaces</h3>
                  <FolderTree size={16} />
                </div>
                <div className="list-stack">
                  {ops.workspaceInventory.length > 0 ? (
                    ops.workspaceInventory.map((summary) => (
                      <div className="list-row" key={summary.agentId}>
                        <div>
                          <strong>{summary.agentId}</strong>
                          <p>{summary.fileCount} files · {summary.modelCount} models · {summary.sessionRegistryCount} saved sessions</p>
                          <small>{summary.rootPath}</small>
                        </div>
                        <div className="list-meta">
                          <span className="status-pill tone-slate">{summary.modelProviderCount} providers</span>
                          <small>{summary.updatedAt ? formatRelativeTime(summary.updatedAt) : 'Unknown'}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No persisted agent workspace inventory has been detected yet.</p>
                  )}
                </div>
              </article>

              <article className="panel">
                <div className="panel-header">
                  <h3>Persisted sessions</h3>
                  <MessagesSquare size={16} />
                </div>
                <div className="list-stack">
                  {ops.persistedSessions.length > 0 ? (
                    ops.persistedSessions.map((sessionItem) => (
                      <div className="list-row" key={sessionItem.sessionKey}>
                        <div>
                          <strong>{sessionItem.sessionId || sessionItem.sessionKey}</strong>
                          <p>{sessionItem.agentId} · {sessionItem.originLabel || 'Unknown origin'}</p>
                          <small>{sessionItem.sessionFile || 'No session file recorded'}</small>
                        </div>
                        <div className="list-meta">
                          <span className="status-pill tone-slate">{sessionItem.deliveryTarget || 'direct'}</span>
                          <small>{formatRelativeTime(sessionItem.updatedAt)}</small>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="empty-copy">No persisted session registry entries have been detected yet.</p>
                  )}
                </div>
              </article>
            </section>
          </div>
        ) : null}

        {activeView === 'settings' ? (
          <div className="content-stack">
            <ViewHeader
              eyebrow="Settings"
              title="Workspace preferences"
              description="Tune the interface density and refresh behavior while keeping Mission Control quiet and operational."
            />

            {settings ? (
              <section className="panel">
                <div className="settings-stack">
                  <label className="settings-row">
                    <span>
                      <strong>Appearance</strong>
                      <small>Stay with system colors or pin the workspace to light or dark.</small>
                    </span>
                    <select
                      className="field control-field"
                      disabled={savingSettings}
                      onChange={(event) => savePreferences({ appearancePreference: event.target.value as AppearancePreference })}
                      value={settings.appearancePreference}
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </select>
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Density</strong>
                      <small>Choose a roomier layout or a tighter operator view.</small>
                    </span>
                    <select
                      className="field control-field"
                      disabled={savingSettings}
                      onChange={(event) => savePreferences({ densityPreference: event.target.value as DensityPreference })}
                      value={settings.densityPreference}
                    >
                      <option value="comfortable">Comfortable</option>
                      <option value="compact">Compact</option>
                    </select>
                  </label>

                  <label className="settings-row">
                    <span>
                      <strong>Auto-refresh</strong>
                      <small>Dial the workspace toward active response or quieter monitoring.</small>
                    </span>
                    <select
                      className="field control-field"
                      disabled={savingSettings}
                      onChange={(event) => savePreferences({ refreshIntervalSeconds: Number(event.target.value) })}
                      value={settings.refreshIntervalSeconds}
                    >
                      <option value="15">15 seconds</option>
                      <option value="30">30 seconds</option>
                      <option value="60">60 seconds</option>
                    </select>
                  </label>

                  <label className="settings-row checkbox-row">
                    <span>
                      <strong>Show completed tasks in Ops</strong>
                      <small>Keep finished operational items visible in the diagnostics feeds.</small>
                    </span>
                    <input
                      checked={settings.showCompletedTasks}
                      disabled={savingSettings}
                      onChange={(event) => savePreferences({ showCompletedTasks: event.target.checked })}
                      type="checkbox"
                    />
                  </label>
                </div>
                {settingsError ? <p className="error-copy">{settingsError}</p> : null}
              </section>
            ) : null}
          </div>
        ) : null}
      </section>
    </main>
  )
}
