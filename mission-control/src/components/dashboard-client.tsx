'use client'

import { startTransition, useEffect, useState, type FormEvent } from 'react'
import {
  Activity,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react'
import type { OverviewPayload, PersistenceStatus, ServiceHealth, SetupIssue } from '@/lib/types'

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
  if (status === 'healthy') {
    return 'tone-green'
  }

  if (status === 'warning' || status === 'degraded') {
    return 'tone-amber'
  }

  if (status === 'critical' || status === 'down') {
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

  return 'Heads-up'
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  return (
    <article className="glass-card compact-card">
      <div className="card-row">
        <span className={cls('status-pill', statusTone(service.status))}>{service.status}</span>
        <span className="eyebrow">{service.name}</span>
      </div>
      <div className="card-value">{service.latency ? `${service.latency} ms` : 'No latency sample'}</div>
      <p className="card-copy">{service.details || 'Probe responded within the latest refresh window.'}</p>
    </article>
  )
}

function PersistenceCard({ store }: { store: PersistenceStatus }) {
  return (
    <article className="glass-card compact-card">
      <div className="card-row">
        <span className={cls('status-pill', statusTone(store.status))}>{store.status}</span>
        <span className="eyebrow">{store.label}</span>
      </div>
      <div className="card-value">{store.populated ? 'Populated' : 'Fresh'}</div>
      <p className="card-copy">{store.details}</p>
      <dl className="detail-grid">
        <div>
          <dt>Path</dt>
          <dd>{store.path}</dd>
        </div>
        <div>
          <dt>Mounted</dt>
          <dd>{store.mounted ? 'Yes' : 'No'}</dd>
        </div>
        {typeof store.fileCount === 'number' ? (
          <div>
            <dt>Entries</dt>
            <dd>{store.fileCount}</dd>
          </div>
        ) : null}
        {typeof store.keyCount === 'number' ? (
          <div>
            <dt>Keys</dt>
            <dd>{store.keyCount}</dd>
          </div>
        ) : null}
        {typeof store.collectionCount === 'number' ? (
          <div>
            <dt>Collections</dt>
            <dd>{store.collectionCount}</dd>
          </div>
        ) : null}
        {store.schemaVersion ? (
          <div>
            <dt>Schema</dt>
            <dd>v{store.schemaVersion}</dd>
          </div>
        ) : null}
      </dl>
    </article>
  )
}

export default function DashboardClient() {
  const [session, setSession] = useState<SessionState>({
    loading: true,
    authenticated: false,
    passwordRequired: true,
  })
  const [payload, setPayload] = useState<OverviewPayload | null>(null)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

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
      const response = await fetch('/api/control-center', {
        cache: 'no-store',
      })

      if (response.status === 401) {
        setPayload(null)
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

      startTransition(() => {
        setPayload(data)
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
    }, 15_000)

    return () => window.clearInterval(intervalId)
  }, [session.authenticated])

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
    await loadSession()
  }

  if (session.loading) {
    return (
      <main className="dashboard-shell">
        <section className="hero-card loading-card">
          <div className="eyebrow">Mission Control</div>
          <h1>Establishing the operator deck</h1>
          <p>Checking auth, persistence, and live stack telemetry.</p>
        </section>
      </main>
    )
  }

  if (session.passwordRequired && !session.authenticated) {
    return (
      <main className="dashboard-shell">
        <section className="auth-card glass-card">
          <div className="eyebrow">Mission Control</div>
          <h1>Unlock the control deck</h1>
          <p>Use the locally configured Mission Control password to access the Phase 1 diagnostics console.</p>
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
    <main className="dashboard-shell">
      <section className="hero-card">
        <div className="hero-topline">
          <div>
            <div className="eyebrow">Mission Control</div>
            <h1>Stack health, persistence, and gateway truth in one place.</h1>
          </div>
          <div className="hero-actions">
            <button className="secondary-button" onClick={() => loadOverview()} type="button">
              <RefreshCw size={16} className={cls(refreshing && 'spin')} />
              Refresh
            </button>
            <button className="secondary-button" onClick={handleLogout} type="button">
              Sign out
            </button>
          </div>
        </div>

        <div className="hero-metrics">
          <article className="metric-panel">
            <span className="eyebrow">Services</span>
            <strong>{payload?.services.filter((service) => service.status === 'healthy').length ?? 0}/{payload?.services.length ?? 0}</strong>
            <span>healthy</span>
          </article>
          <article className="metric-panel">
            <span className="eyebrow">Gateway</span>
            <strong>{payload?.gateway.connected ? 'Live' : 'Offline'}</strong>
            <span>{payload?.gateway.agentCount ?? 0} agents tracked</span>
          </article>
          <article className="metric-panel">
            <span className="eyebrow">Persistence</span>
            <strong>{payload?.persistence.filter((store) => store.mounted).length ?? 0}/{payload?.persistence.length ?? 0}</strong>
            <span>bind roots mounted</span>
          </article>
          <article className="metric-panel">
            <span className="eyebrow">Refreshed</span>
            <strong>{payload ? formatRelativeTime(payload.generatedAt) : 'pending'}</strong>
            <span>every 15 seconds</span>
          </article>
        </div>
      </section>

      {error ? (
        <section className="glass-card alert-banner">
          <AlertTriangle size={18} />
          <div>
            <strong>Mission Control hit a refresh problem.</strong>
            <p>{error}</p>
          </div>
        </section>
      ) : null}

      {payload ? (
        <>
          <section className="section-block">
            <div className="section-header">
              <div>
                <div className="eyebrow">Stack Health</div>
                <h2>Service health grid</h2>
              </div>
              <Activity size={18} className="section-icon" />
            </div>
            <div className="card-grid three-up">
              {payload.services.map((service) => (
                <ServiceCard key={service.name} service={service} />
              ))}
            </div>
          </section>

          <section className="section-block">
            <div className="section-header">
              <div>
                <div className="eyebrow">Persistence</div>
                <h2>Bind-mounted storage verification</h2>
              </div>
            </div>
            <div className="card-grid two-up">
              {payload.persistence.map((store) => (
                <PersistenceCard key={store.id} store={store} />
              ))}
            </div>
          </section>

          <section className="card-grid split-layout">
            <article className="glass-card large-card">
              <div className="section-header">
                <div>
                  <div className="eyebrow">Gateway</div>
                  <h2>Agent and session snapshot</h2>
                </div>
              </div>
              <div className="inline-metrics">
                <div>
                  <dt>Agents</dt>
                  <dd>{payload.gateway.agentCount}</dd>
                </div>
                <div>
                  <dt>Sessions</dt>
                  <dd>{payload.gateway.sessionCount}</dd>
                </div>
                <div>
                  <dt>Models</dt>
                  <dd>{payload.gateway.models.length > 0 ? payload.gateway.models.join(', ') : 'No live models yet'}</dd>
                </div>
              </div>
              <div className="stack-list">
                {payload.gateway.agents.length > 0 ? (
                  payload.gateway.agents.map((agent) => (
                    <div className="stack-item" key={agent.id}>
                      <div>
                        <strong>{agent.name}</strong>
                        <p>{agent.model}</p>
                      </div>
                      <span className={cls('status-pill', statusTone(agent.status))}>{agent.status}</span>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No live agents were returned by the gateway.</p>
                )}
              </div>

              <div className="session-stack">
                {payload.gateway.sessions.length > 0 ? (
                  payload.gateway.sessions.slice(0, 6).map((sessionItem) => (
                    <div className="session-row" key={sessionItem.sessionKey}>
                      <div>
                        <strong>{sessionItem.label}</strong>
                        <p>{sessionItem.agentId} · {formatRelativeTime(sessionItem.updatedAt)}</p>
                      </div>
                      <div className="session-usage">
                        <span>{sessionItem.contextUsagePct}% context</span>
                        <div className="progress-track">
                          <div className="progress-fill" style={{ width: `${Math.min(100, sessionItem.contextUsagePct)}%` }} />
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="empty-copy">No active sessions were reported by OpenClaw.</p>
                )}
              </div>
            </article>

            <article className="glass-card large-card">
              <div className="section-header">
                <div>
                  <div className="eyebrow">Setup Issues</div>
                  <h2>Actionable remediation list</h2>
                </div>
              </div>
              <div className="issue-stack">
                {payload.setupIssues.map((issue) => (
                  <div className="issue-item" key={issue.id}>
                    <div className="issue-topline">
                      <span className={cls('status-pill', statusTone(issue.severity))}>{severityLabel(issue.severity)}</span>
                      <strong>{issue.title}</strong>
                    </div>
                    <p>{issue.details}</p>
                    <small>{issue.action}</small>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </>
      ) : (
        <section className="glass-card loading-card">
          <div className="eyebrow">Overview</div>
          <h2>Loading live stack state</h2>
          <p>Waiting for authenticated service health, persistence status, and gateway telemetry.</p>
        </section>
      )}
    </main>
  )
}
