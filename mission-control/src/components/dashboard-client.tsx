'use client'

import { startTransition, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileCode2,
  FolderTree,
  LayoutDashboard,
  ListTodo,
  MessagesSquare,
  RefreshCw,
  SlidersHorizontal,
} from 'lucide-react'
import type {
  AgentWorkspaceSummary,
  AppearancePreference,
  DashboardPreferences,
  DensityPreference,
  MissionControlTask,
  OpenClawConfiguredAgent,
  OverviewPayload,
  PersistedChatSession,
  SetupIssue,
  SessionInfo,
  TaskPriority,
  TaskStatus,
} from '@/lib/types'

type SessionState = {
  loading: boolean
  authenticated: boolean
  passwordRequired: boolean
}

type SessionResponse = {
  ok: boolean
  authenticated: boolean
  passwordRequired: boolean
}

type PanelView = 'overview' | 'agents' | 'sessions' | 'tasks' | 'config' | 'settings'

type SettingsState = DashboardPreferences

type AgentRegistryRow = {
  id: string
  label: string
  workspace: string | null
  theme: string | null
  model: string
  source: string
  status: string
  sessions: number
}

type AgentFilesResponse = {
  ok: boolean
  error?: string
  agents?: AgentWorkspaceSummary[]
}

type ChatResponse = {
  ok: boolean
  error?: string
  liveSessions?: SessionInfo[]
  persistedSessions?: PersistedChatSession[]
}

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
  if (status === 'healthy' || status === 'active' || status === 'done' || status === 'live') {
    return 'tone-green'
  }

  if (status === 'warning' || status === 'degraded' || status === 'blocked' || status === 'config only') {
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

function buildAgentRegistry(payload: OverviewPayload): AgentRegistryRow[] {
  const liveById = new Map(payload.gateway.agents.map((agent) => [agent.id, agent]))
  const configuredById = new Map(payload.openclawConfig.configuredAgents.map((agent) => [agent.id, agent]))
  const sessionCounts = payload.gateway.sessions.reduce<Record<string, number>>((accumulator, session) => {
    accumulator[session.agentId] = (accumulator[session.agentId] || 0) + 1
    return accumulator
  }, {})
  const ids = Array.from(new Set([...configuredById.keys(), ...liveById.keys()])).sort((left, right) => left.localeCompare(right))

  return ids.map((id) => {
    const configured = configuredById.get(id)
    const live = liveById.get(id)

    return {
      id,
      label: configured?.identityName || configured?.name || live?.name || id,
      workspace: configured?.workspace || null,
      theme: configured?.identityTheme || null,
      model: live?.model || 'No live model detected',
      source: configured && live ? 'config + live' : configured ? 'config only' : 'live only',
      status: live?.status || 'config only',
      sessions: sessionCounts[id] || live?.sessions || 0,
    }
  })
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
  })
  const [activeView, setActiveView] = useState<PanelView>('overview')
  const [payload, setPayload] = useState<OverviewPayload | null>(null)
  const [workspaceInventory, setWorkspaceInventory] = useState<AgentWorkspaceSummary[]>([])
  const [persistedSessions, setPersistedSessions] = useState<PersistedChatSession[]>([])
  const [password, setPassword] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskDescription, setTaskDescription] = useState('')
  const [taskPriority, setTaskPriority] = useState<TaskPriority>('medium')
  const [settings, setSettings] = useState<SettingsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [settingsError, setSettingsError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [creatingTask, setCreatingTask] = useState(false)
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)

  const refreshSeconds = payload?.preferences.refreshIntervalSeconds ?? 15
  const agentRegistry = useMemo(() => (payload ? buildAgentRegistry(payload) : []), [payload])
  const workspaceByAgent = useMemo(
    () => new Map(workspaceInventory.map((summary) => [summary.agentId, summary])),
    [workspaceInventory],
  )

  async function loadSession() {
    try {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
      })
      const data = (await response.json()) as SessionResponse

      startTransition(() => {
        setSession({
          loading: false,
          authenticated: data.authenticated,
          passwordRequired: data.passwordRequired,
        })
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to establish the Mission Control session.')
      setSession({
        loading: false,
        authenticated: false,
        passwordRequired: true,
      })
    }
  }

  async function loadOverview() {
    setRefreshing(true)

    try {
      const [response, agentFilesResponse, chatResponse] = await Promise.all([
        fetch('/api/control-center', {
          cache: 'no-store',
        }),
        fetch('/api/agent-files', {
          cache: 'no-store',
        }),
        fetch('/api/chat', {
          cache: 'no-store',
        }),
      ])

      if (response.status === 401) {
        setPayload(null)
        setWorkspaceInventory([])
        setPersistedSessions([])
        setSession((current) => ({
          ...current,
          authenticated: false,
        }))
        return
      }

      const data = (await response.json()) as OverviewPayload & { error?: string }

      if (!response.ok) {
        throw new Error(data.error || 'Unable to load Mission Control.')
      }

      let nextWorkspaceInventory: AgentWorkspaceSummary[] = []
      let nextPersistedSessions: PersistedChatSession[] = []

      if (agentFilesResponse.ok) {
        const agentFiles = (await agentFilesResponse.json()) as AgentFilesResponse

        if (agentFiles.ok && Array.isArray(agentFiles.agents)) {
          nextWorkspaceInventory = agentFiles.agents
        }
      }

      if (chatResponse.ok) {
        const chatData = (await chatResponse.json()) as ChatResponse

        if (chatData.ok && Array.isArray(chatData.persistedSessions)) {
          nextPersistedSessions = chatData.persistedSessions
        }
      }

      startTransition(() => {
        setPayload(data)
        setSettings(data.preferences)
        setWorkspaceInventory(nextWorkspaceInventory)
        setPersistedSessions(nextPersistedSessions)
        setError(null)
      })
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load Mission Control.')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSession()
  }, [])

  useEffect(() => {
    if (!session.authenticated) {
      return
    }

    loadOverview()

    const intervalId = window.setInterval(() => {
      loadOverview()
    }, refreshSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [session.authenticated, refreshSeconds])

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
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Incorrect password.')
      }

      setPassword('')
      await loadSession()
    } catch (requestError) {
      setLoginError(requestError instanceof Error ? requestError.message : 'Unable to establish the Mission Control session.')
    }
  }

  async function handleLogout() {
    await fetch('/api/auth/logout', {
      method: 'POST',
    })

    setPayload(null)
    setWorkspaceInventory([])
    setPersistedSessions([])
    await loadSession()
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
      await loadOverview()
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
        }),
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to create the task.')
      }

      setTaskTitle('')
      setTaskDescription('')
      setTaskPriority('medium')
      await loadOverview()
    } catch (requestError) {
      setTaskError(requestError instanceof Error ? requestError.message : 'Unable to create the task.')
    } finally {
      setCreatingTask(false)
    }
  }

  async function updateTask(task: MissionControlTask, patch: Partial<MissionControlTask>) {
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
        }),
      })
      const data = (await response.json()) as { ok: boolean; error?: string }

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Unable to update the task.')
      }

      await loadOverview()
    } catch (requestError) {
      setTaskError(requestError instanceof Error ? requestError.message : 'Unable to update the task.')
    } finally {
      setUpdatingTaskId(null)
    }
  }

  if (session.loading) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="eyebrow">ClawStack Admin</div>
          <h1>Loading the admin suite</h1>
          <p>Connecting stack telemetry, operator state, and agent data.</p>
        </section>
      </main>
    )
  }

  if (session.passwordRequired && !session.authenticated) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="eyebrow">ClawStack Admin</div>
          <h1>Operator sign in</h1>
          <p>Mission Control is now structured as an admin suite for agent operations. Sign in to continue.</p>
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
          {loginError ? <p className="error-copy">{loginError}</p> : null}
          {error ? <p className="error-copy">{error}</p> : null}
        </section>
      </main>
    )
  }

  return (
    <main
      className={cls(
        'admin-shell',
        payload?.preferences.densityPreference === 'compact' && 'compact-density',
        payload?.preferences.appearancePreference === 'light' && 'appearance-light',
        payload?.preferences.appearancePreference === 'dark' && 'appearance-dark',
      )}
    >
      <aside className="admin-sidebar">
        <div>
          <div className="brand-mark">ClawStack</div>
          <h1>Admin Panel</h1>
          <p>Agent management framework with operational control, config visibility, and operator workflow.</p>
        </div>

        <nav className="nav-stack">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutDashboard },
            { id: 'agents', label: 'Agents', icon: Bot },
            { id: 'sessions', label: 'Sessions', icon: MessagesSquare },
            { id: 'tasks', label: 'Tasks', icon: ListTodo },
            { id: 'config', label: 'Config', icon: FileCode2 },
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
          <div className="eyebrow">Vision</div>
          <p>ClawStack is being shaped into a Jira-class operating surface for agent systems, not just a status dashboard.</p>
        </div>
      </aside>

      <section className="admin-main">
        <header className="topbar">
          <div>
            <div className="eyebrow">Mission Control</div>
            <h2>Operator workspace</h2>
            <p>Minimal, operational, and structured around agents, queues, sessions, and persisted workspace state.</p>
          </div>
          <div className="topbar-actions">
            <button className="secondary-button" onClick={() => loadOverview()} type="button">
              <RefreshCw size={16} className={cls(refreshing && 'spin')} />
              Refresh
            </button>
            <button className="secondary-button" onClick={handleLogout} type="button">
              Sign out
            </button>
          </div>
        </header>

        {payload ? (
          <>
            <section className="metric-strip">
              <article className="metric-card">
                <span className="metric-label">Healthy services</span>
                <strong>{payload.services.filter((service) => service.status === 'healthy').length}/{payload.services.length}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Live agents</span>
                <strong>{payload.gateway.agentCount}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Open tasks</span>
                <strong>{payload.tasks.summary.open}</strong>
              </article>
              <article className="metric-card">
                <span className="metric-label">Persisted sessions</span>
                <strong>{persistedSessions.length}</strong>
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
                  title="System posture"
                  description="A clean operator summary of service health, persistent state, and remediation pressure."
                />

                <section className="content-grid two-column">
                  <article className="panel">
                    <div className="panel-header">
                      <h3>Service health</h3>
                      <Activity size={16} />
                    </div>
                    <div className="list-stack">
                      {payload.services.map((service) => (
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
                      {payload.setupIssues.map((issue) => (
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
                    </div>
                    <div className="list-stack">
                      {payload.persistence.map((store) => (
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
                      <h3>Config + queue snapshot</h3>
                    </div>
                    <dl className="detail-grid">
                      <div>
                        <dt>OpenClaw config</dt>
                        <dd>{payload.openclawConfig.valid ? 'Valid JSON' : 'Needs attention'}</dd>
                      </div>
                      <div>
                        <dt>Configured agents</dt>
                        <dd>{payload.openclawConfig.configuredAgents.length}</dd>
                      </div>
                      <div>
                        <dt>Sessions</dt>
                        <dd>{payload.gateway.sessionCount}</dd>
                      </div>
                      <div>
                        <dt>Persisted sessions</dt>
                        <dd>{persistedSessions.length}</dd>
                      </div>
                    </dl>
                  </article>
                </section>
              </div>
            ) : null}

            {activeView === 'agents' ? (
              <div className="content-stack">
                <ViewHeader
                  eyebrow="Agents"
                  title="Agent registry"
                  description="A combined management surface for configured agents, live runtime state, workspace inventory, and ownership context."
                />

                <section className="content-grid two-column">
                  <article className="panel">
                    <div className="panel-header">
                      <h3>Registry</h3>
                      <Bot size={16} />
                    </div>
                    <div className="list-stack">
                      {agentRegistry.map((agent) => (
                        <div className="list-row" key={agent.id}>
                          <div>
                            <strong>{agent.label}</strong>
                            <p>{agent.id} · {agent.workspace || 'No workspace declared'}</p>
                            <small>
                              {agent.source}
                              {workspaceByAgent.get(agent.id)
                                ? ` · ${workspaceByAgent.get(agent.id)?.fileCount ?? 0} files tracked`
                                : ' · No workspace inventory detected'}
                            </small>
                          </div>
                          <div className="list-meta">
                            <span className={cls('status-pill', statusTone(agent.status))}>{agent.status}</span>
                            <small>{agent.model}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>

                  <article className="panel">
                    <div className="panel-header">
                      <h3>Workspace inventory</h3>
                      <FolderTree size={16} />
                    </div>
                    <div className="list-stack">
                      {workspaceInventory.length > 0 ? (
                        workspaceInventory.map((summary) => (
                          <div className="list-row" key={summary.agentId}>
                            <div>
                              <strong>{summary.agentId}</strong>
                              <p>{summary.fileCount} files · {summary.modelCount} models · {summary.sessionRegistryCount} saved sessions</p>
                              <small>{summary.files.length > 0 ? summary.files.join(', ') : 'No tracked files yet'}</small>
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
                </section>
              </div>
            ) : null}

            {activeView === 'sessions' ? (
              <div className="content-stack">
                <ViewHeader
                  eyebrow="Sessions"
                  title="Runtime and persisted sessions"
                  description="Review live gateway sessions alongside what has actually been written to disk for each agent."
                />

                <section className="content-grid two-column">
                  <article className="panel">
                    <div className="panel-header">
                      <h3>Live gateway sessions</h3>
                      <MessagesSquare size={16} />
                    </div>
                    <div className="list-stack">
                      {payload.gateway.sessions.length > 0 ? (
                        payload.gateway.sessions.map((sessionItem) => (
                          <div className="list-row" key={sessionItem.sessionKey}>
                            <div>
                              <strong>{sessionItem.label}</strong>
                              <p>{sessionItem.agentId} · {sessionItem.model || 'No model recorded'}</p>
                              <small>{sessionItem.totalTokens.toLocaleString()} total tokens · {sessionItem.reasoningMode || 'standard reasoning'}</small>
                            </div>
                            <div className="list-meta">
                              <span className="status-pill tone-slate">{sessionItem.contextUsagePct}% context</span>
                              <small>{formatRelativeTime(sessionItem.updatedAt)}</small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="empty-copy">No active sessions are currently reported by the gateway.</p>
                      )}
                    </div>
                  </article>

                  <article className="panel">
                    <div className="panel-header">
                      <h3>Persisted session registry</h3>
                      <Database size={16} />
                    </div>
                    <div className="list-stack">
                      {persistedSessions.length > 0 ? (
                        persistedSessions.map((sessionItem) => (
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
                        <p className="empty-copy">Mission Control has not detected any persisted session registry entries yet.</p>
                      )}
                    </div>
                  </article>
                </section>
              </div>
            ) : null}

            {activeView === 'tasks' ? (
              <div className="content-stack">
                <ViewHeader
                  eyebrow="Tasks"
                  title="Operator work queue"
                  description="Track operational work around agents, incidents, handoffs, and config changes directly inside the admin panel."
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
                        placeholder="Add an operator task"
                        value={taskTitle}
                      />
                      <textarea
                        className="field text-area"
                        onChange={(event) => setTaskDescription(event.target.value)}
                        placeholder="Optional notes, runbook links, or remediation details"
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
                        <button className="primary-button" disabled={creatingTask} type="submit">
                          {creatingTask ? 'Saving…' : 'Create task'}
                        </button>
                      </div>
                    </form>
                    {taskError ? <p className="error-copy">{taskError}</p> : null}
                  </article>

                  <article className="panel">
                    <div className="panel-header">
                      <h3>Queue summary</h3>
                    </div>
                    <div className="metric-strip nested-strip">
                      <article className="metric-card">
                        <span className="metric-label">Open</span>
                        <strong>{payload.tasks.summary.open}</strong>
                      </article>
                      <article className="metric-card">
                        <span className="metric-label">Blocked</span>
                        <strong>{payload.tasks.summary.blocked}</strong>
                      </article>
                      <article className="metric-card">
                        <span className="metric-label">Done</span>
                        <strong>{payload.tasks.summary.done}</strong>
                      </article>
                    </div>
                  </article>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <h3>Tracked tasks</h3>
                  </div>
                  <div className="list-stack">
                    {payload.tasks.recent.length > 0 ? (
                      payload.tasks.recent.map((task) => (
                        <div className="list-row task-row" key={task.id}>
                          <div>
                            <strong>{task.title}</strong>
                            <p>{task.description || 'No task notes yet.'}</p>
                            <small>Updated {formatRelativeTime(task.updatedAt)}</small>
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
                            <button
                              className="secondary-button"
                              disabled={updatingTaskId === task.id || task.status === 'done'}
                              onClick={() => updateTask(task, { status: 'done' })}
                              type="button"
                            >
                              <CheckCircle2 size={15} />
                              {task.status === 'done' ? 'Done' : 'Mark done'}
                            </button>
                            <span className={cls('status-pill', statusTone(task.status))}>{prettifyTaskStatus(task.status)}</span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="empty-copy">No operator tasks yet.</p>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {activeView === 'config' ? (
              <div className="content-stack">
                <ViewHeader
                  eyebrow="Config"
                  title="OpenClaw configuration surface"
                  description="Inspect the persisted gateway config, allowed origins, version metadata, and configured agent declarations from one place."
                />

                <section className="content-grid two-column">
                  <article className="panel">
                    <div className="panel-header">
                      <h3>Config file</h3>
                      <FileCode2 size={16} />
                    </div>
                    <dl className="detail-grid">
                      <div>
                        <dt>Path</dt>
                        <dd>{payload.openclawConfig.path}</dd>
                      </div>
                      <div>
                        <dt>Status</dt>
                        <dd>{payload.openclawConfig.valid ? 'Valid JSON' : 'Needs review'}</dd>
                      </div>
                      <div>
                        <dt>Version</dt>
                        <dd>{payload.openclawConfig.lastTouchedVersion || 'Unknown'}</dd>
                      </div>
                      <div>
                        <dt>Last touched</dt>
                        <dd>{payload.openclawConfig.lastTouchedAt ? formatRelativeTime(payload.openclawConfig.lastTouchedAt) : 'Unknown'}</dd>
                      </div>
                    </dl>
                  </article>

                  <article className="panel">
                    <div className="panel-header">
                      <h3>Allowed origins</h3>
                    </div>
                    <div className="tag-row">
                      {payload.openclawConfig.allowedOrigins.length > 0 ? (
                        payload.openclawConfig.allowedOrigins.map((origin) => (
                          <span className="tag-chip" key={origin}>
                            {origin}
                          </span>
                        ))
                      ) : (
                        <p className="empty-copy">No control UI origins are explicitly declared.</p>
                      )}
                    </div>
                  </article>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <h3>Configured agents</h3>
                  </div>
                  <div className="list-stack">
                    {payload.openclawConfig.configuredAgents.map((agent: OpenClawConfiguredAgent) => (
                      <div className="list-row" key={agent.id}>
                        <div>
                          <strong>{agent.identityName || agent.name}</strong>
                          <p>{agent.id} · {agent.workspace || 'No workspace declared'}</p>
                          <small>{agent.agentDir || 'No agentDir declared'}</small>
                        </div>
                        <div className="list-meta">
                          <span className="status-pill tone-slate">{agent.identityTheme || 'No theme'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel">
                  <div className="panel-header">
                    <h3>Persisted workspace map</h3>
                  </div>
                  <div className="list-stack">
                    {workspaceInventory.length > 0 ? (
                      workspaceInventory.map((summary) => (
                        <div className="list-row" key={summary.agentId}>
                          <div>
                            <strong>{summary.agentId}</strong>
                            <p>{summary.rootPath}</p>
                            <small>{summary.files.length > 0 ? summary.files.join(', ') : 'No tracked files yet'}</small>
                          </div>
                          <div className="list-meta">
                            <span className="status-pill tone-slate">{summary.fileCount} files</span>
                            <small>{summary.updatedAt ? formatRelativeTime(summary.updatedAt) : 'Unknown'}</small>
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="empty-copy">No persisted agent workspaces have been detected yet.</p>
                    )}
                  </div>
                </section>
              </div>
            ) : null}

            {activeView === 'settings' ? (
              <div className="content-stack">
                <ViewHeader
                  eyebrow="Settings"
                  title="Admin panel preferences"
                  description="Tune the workspace density and refresh behavior while keeping the interface quiet and operational."
                />

                {settings ? (
                  <section className="panel">
                    <div className="settings-stack">
                      <label className="settings-row">
                        <span>
                          <strong>Appearance</strong>
                          <small>Stay with system colors or pin the admin panel to light or dark.</small>
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
                          <small>Choose a roomier layout or a tighter admin view.</small>
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
                          <small>Dial the suite toward active response or quieter monitoring.</small>
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
                          <strong>Show completed tasks</strong>
                          <small>Keep finished items in the queue instead of collapsing the focus to active work only.</small>
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
          </>
        ) : (
          <section className="panel">
            <p>Loading operator data…</p>
          </section>
        )}
      </section>
    </main>
  )
}
