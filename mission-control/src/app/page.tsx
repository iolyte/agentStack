'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Bot, Database, Zap, DollarSign,
  Clock, CheckCircle, AlertCircle, RefreshCw,
  TerminalSquare, Cpu, HardDrive, Wifi, Send,
  ChevronRight, Circle, BarChart3, Settings,
  Server, Package, Shield, MessageSquare
} from 'lucide-react'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'

// ── Types ──────────────────────────────────────────────────────
type ServiceStatus = 'healthy' | 'degraded' | 'down' | 'unknown'
type TaskStatus = 'planning' | 'inbox' | 'assigned' | 'in_progress' | 'review' | 'done'

interface ServiceHealth {
  name: string
  status: ServiceStatus
  latency?: number
  version?: string
}

interface Agent {
  id: string
  name: string
  model: string
  status: 'active' | 'idle' | 'working'
  tokensIn: number
  tokensOut: number
  costUsd: number
  sessions: number
}

interface Task {
  id: string
  title: string
  status: TaskStatus
  agentId?: string
  createdAt: string
}

interface Event {
  id: string
  type: string
  message: string
  agentId?: string
  timestamp: string
}

// ── Mock data (replace with real API calls) ───────────────────
const MOCK_SERVICES: ServiceHealth[] = [
  { name: 'OpenClaw', status: 'healthy', latency: 12, version: '2026.4.8' },
  { name: 'PostgreSQL', status: 'healthy', latency: 3 },
  { name: 'Redis', status: 'healthy', latency: 1 },
  { name: 'Qdrant', status: 'healthy', latency: 8 },
  { name: 'Nginx', status: 'healthy', latency: 2 },
]

const MOCK_AGENTS: Agent[] = [
  { id: '1', name: 'main', model: 'claude-sonnet-4-6', status: 'idle', tokensIn: 142000, tokensOut: 38000, costUsd: 2.14, sessions: 47 },
  { id: '2', name: 'researcher', model: 'openai/gpt-4o', status: 'working', tokensIn: 89000, tokensOut: 21000, costUsd: 1.43, sessions: 23 },
  { id: '3', name: 'coder', model: 'anthropic/claude-opus-4-6', status: 'idle', tokensIn: 201000, tokensOut: 52000, costUsd: 6.81, sessions: 61 },
]

const MOCK_TASKS: Task[] = [
  { id: '1', title: 'Research competitor pricing', status: 'in_progress', agentId: '2', createdAt: '2026-04-09T10:00:00Z' },
  { id: '2', title: 'Write API documentation', status: 'assigned', agentId: '3', createdAt: '2026-04-09T09:30:00Z' },
  { id: '3', title: 'Fix auth middleware bug', status: 'review', agentId: '3', createdAt: '2026-04-09T08:00:00Z' },
  { id: '4', title: 'Daily standup summary', status: 'done', agentId: '1', createdAt: '2026-04-09T07:00:00Z' },
  { id: '5', title: 'Analyze usage metrics', status: 'inbox', createdAt: '2026-04-09T11:00:00Z' },
]

const MOCK_EVENTS: Event[] = [
  { id: '1', type: 'task_complete', message: 'researcher finished "Market analysis" in 4m 12s', agentId: '2', timestamp: '2m ago' },
  { id: '2', type: 'tool_call', message: 'coder → web_search("Next.js 14 app router")', agentId: '3', timestamp: '5m ago' },
  { id: '3', type: 'session_start', message: 'main session started via Telegram', agentId: '1', timestamp: '12m ago' },
  { id: '4', type: 'cost_alert', message: 'Daily spend reached $8.20 (80% of cap)', timestamp: '18m ago' },
  { id: '5', type: 'task_assigned', message: 'Task "Fix auth bug" dispatched to coder', agentId: '3', timestamp: '31m ago' },
]

const MOCK_COST_DATA = [
  { day: 'Mon', cost: 3.2 }, { day: 'Tue', cost: 5.1 }, { day: 'Wed', cost: 4.4 },
  { day: 'Thu', cost: 7.8 }, { day: 'Fri', cost: 6.2 }, { day: 'Sat', cost: 2.1 },
  { day: 'Sun', cost: 4.9 },
]

const MOCK_TOKEN_DATA = [
  { hour: '00', tokens: 1200 }, { hour: '04', tokens: 400 }, { hour: '08', tokens: 8900 },
  { hour: '10', tokens: 14200 }, { hour: '12', tokens: 11000 }, { hour: '14', tokens: 16800 },
  { hour: '16', tokens: 12100 }, { hour: '18', tokens: 7400 }, { hour: '20', tokens: 4200 },
]

// ── Components ────────────────────────────────────────────────

function StatusDot({ status }: { status: ServiceStatus }) {
  const colors: Record<ServiceStatus, string> = {
    healthy: '#22c55e',
    degraded: '#eab308',
    down: '#ef4444',
    unknown: '#6b7280',
  }
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      backgroundColor: colors[status],
      boxShadow: status === 'healthy' ? `0 0 6px ${colors[status]}` : 'none',
    }} />
  )
}

function AgentStatusBadge({ status }: { status: Agent['status'] }) {
  const styles: Record<Agent['status'], { bg: string; text: string; label: string }> = {
    active:  { bg: 'rgba(34,197,94,0.1)',  text: '#22c55e', label: 'active' },
    idle:    { bg: 'rgba(107,114,128,0.1)', text: '#9ca3af', label: 'idle' },
    working: { bg: 'rgba(249,115,22,0.1)',  text: '#f97316', label: 'working' },
  }
  const s = styles[status]
  return (
    <span style={{
      padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      background: s.bg, color: s.text, fontFamily: 'JetBrains Mono, monospace',
    }}>
      {status === 'working' && '⟳ '}{s.label}
    </span>
  )
}

function TaskBadge({ status }: { status: TaskStatus }) {
  const colors: Record<TaskStatus, string> = {
    planning: '#6366f1', inbox: '#6b7280', assigned: '#3b82f6',
    in_progress: '#f97316', review: '#eab308', done: '#22c55e',
  }
  return (
    <span style={{
      padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 600,
      background: `${colors[status]}22`, color: colors[status],
      textTransform: 'uppercase', letterSpacing: '0.05em',
      fontFamily: 'JetBrains Mono, monospace',
    }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function EventIcon({ type }: { type: string }) {
  const icons: Record<string, { icon: string; color: string }> = {
    task_complete: { icon: '✓', color: '#22c55e' },
    tool_call:     { icon: '⟳', color: '#3b82f6' },
    session_start: { icon: '▶', color: '#f97316' },
    cost_alert:    { icon: '⚠', color: '#eab308' },
    task_assigned: { icon: '→', color: '#6366f1' },
  }
  const e = icons[type] || { icon: '·', color: '#6b7280' }
  return (
    <span style={{
      width: 22, height: 22, borderRadius: 4, display: 'flex', alignItems: 'center',
      justifyContent: 'center', fontSize: 11, fontWeight: 700,
      background: `${e.color}20`, color: e.color, flexShrink: 0,
    }}>{e.icon}</span>
  )
}

// ── Navigation ────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'overview',  label: 'Overview',  icon: BarChart3 },
  { id: 'agents',    label: 'Agents',    icon: Bot },
  { id: 'tasks',     label: 'Tasks',     icon: CheckCircle },
  { id: 'chat',      label: 'Chat',      icon: MessageSquare },
  { id: 'costs',     label: 'Costs',     icon: DollarSign },
  { id: 'stack',     label: 'Stack',     icon: Server },
]

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState('overview')
  const [gatewayStatus, setGatewayStatus] = useState<'connected' | 'disconnected'>('connected')
  const [chatMessage, setChatMessage] = useState('')
  const [chatAgent, setChatAgent] = useState(MOCK_AGENTS[0])
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([
    { role: 'assistant', content: 'Hey! I\'m your main agent. What do you need?' },
  ])
  const [isTyping, setIsTyping] = useState(false)

  const totalCost = MOCK_AGENTS.reduce((s, a) => s + a.costUsd, 0)
  const totalTokens = MOCK_AGENTS.reduce((s, a) => s + a.tokensIn + a.tokensOut, 0)
  const activeTasks = MOCK_TASKS.filter(t => t.status === 'in_progress').length

  const sendChat = useCallback(async () => {
    if (!chatMessage.trim()) return
    const msg = chatMessage.trim()
    setChatMessage('')
    setChatHistory(h => [...h, { role: 'user', content: msg }])
    setIsTyping(true)
    // Simulated response — replace with real WS call to OpenClaw
    setTimeout(() => {
      setChatHistory(h => [...h, { role: 'assistant', content: `Got it — working on "${msg}". I'll report back when done.` }])
      setIsTyping(false)
    }, 1200)
  }, [chatMessage])

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'var(--bg)', overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <aside style={{
        width: 220, background: 'var(--surface)', borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ padding: '20px 16px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>🦞</span>
            <div>
              <div style={{ fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                clawstack
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace' }}>
                mission control
              </div>
            </div>
          </div>
        </div>

        {/* Gateway status */}
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
            <StatusDot status={gatewayStatus === 'connected' ? 'healthy' : 'down'} />
            <span>Gateway {gatewayStatus}</span>
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0' }}>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              style={{
                width: '100%', padding: '9px 16px',
                display: 'flex', alignItems: 'center', gap: 10,
                background: activeTab === id ? 'var(--accent-dim)' : 'transparent',
                border: 'none', cursor: 'pointer', textAlign: 'left',
                borderLeft: activeTab === id ? '2px solid var(--accent)' : '2px solid transparent',
                color: activeTab === id ? 'var(--accent)' : 'var(--text-dim)',
                fontSize: 13, fontWeight: activeTab === id ? 600 : 400,
                fontFamily: 'DM Sans, sans-serif',
                transition: 'all 0.1s',
              }}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </nav>

        {/* Version */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace' }}>
          iolyte/clawstack v1.0.0
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>

        {/* ── OVERVIEW TAB ── */}
        {activeTab === 'overview' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>
              Overview
            </h1>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: 'Total Agents', value: MOCK_AGENTS.length, sub: `${MOCK_AGENTS.filter(a => a.status === 'working').length} working`, icon: Bot, color: '#f97316' },
                { label: 'Active Tasks', value: activeTasks, sub: `${MOCK_TASKS.length} total`, icon: CheckCircle, color: '#22c55e' },
                { label: "Today's Cost", value: `$${totalCost.toFixed(2)}`, sub: 'across all agents', icon: DollarSign, color: '#3b82f6' },
                { label: 'Total Tokens', value: `${(totalTokens / 1000).toFixed(0)}k`, sub: 'this session', icon: Zap, color: '#a855f7' },
              ].map(({ label, value, sub, icon: Icon, color }) => (
                <div key={label} className="card card-hover" style={{ position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', top: 12, right: 12, opacity: 0.15 }}>
                    <Icon size={32} color={color} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-dimmer)', marginBottom: 6, fontFamily: 'DM Sans, sans-serif', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
                  <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'Syne, sans-serif', color }}>{value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dimmer)', marginTop: 4 }}>{sub}</div>
                </div>
              ))}
            </div>

            {/* Charts row */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {/* Cost chart */}
              <div className="card">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <DollarSign size={14} color="var(--accent)" /> Spend — Last 7 Days
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <AreaChart data={MOCK_COST_DATA}>
                    <defs>
                      <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#555' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#555' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12 }} formatter={(v: number) => [`$${v}`, 'Cost']} />
                    <Area type="monotone" dataKey="cost" stroke="#f97316" strokeWidth={2} fill="url(#costGrad)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              {/* Token chart */}
              <div className="card">
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} color="#3b82f6" /> Token Usage — Today
                </div>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={MOCK_TOKEN_DATA}>
                    <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#555' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#555' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 6, fontSize: 12 }} formatter={(v: number) => [v.toLocaleString(), 'Tokens']} />
                    <Bar dataKey="tokens" fill="#3b82f6" radius={[3, 3, 0, 0]} opacity={0.8} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Live feed */}
            <div className="card">
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Activity size={14} color="var(--green)" /> Live Feed
                <span className="dot-green" style={{ marginLeft: 4 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {MOCK_EVENTS.map(event => (
                  <div key={event.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <EventIcon type={event.type} />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontSize: 12, color: 'var(--text)' }}>{event.message}</span>
                    </div>
                    <span style={{ fontSize: 10, color: 'var(--text-dimmer)', whiteSpace: 'nowrap', fontFamily: 'JetBrains Mono, monospace' }}>{event.timestamp}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── AGENTS TAB ── */}
        {activeTab === 'agents' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Agents</h1>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {MOCK_AGENTS.map(agent => (
                <div key={agent.id} className="card card-hover" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto', alignItems: 'center', gap: 20 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <Bot size={14} color="var(--accent)" />
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{agent.name}</span>
                      <AgentStatusBadge status={agent.status} />
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace' }}>{agent.model}</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{agent.sessions}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>sessions</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{(agent.tokensIn / 1000).toFixed(0)}k</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>tokens in</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{(agent.tokensOut / 1000).toFixed(0)}k</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>tokens out</div>
                  </div>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)' }}>${agent.costUsd.toFixed(2)}</div>
                    <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>cost</div>
                  </div>
                  <button
                    onClick={() => { setActiveTab('chat'); setChatAgent(agent) }}
                    style={{
                      padding: '6px 12px', borderRadius: 6, border: '1px solid var(--border)',
                      background: 'var(--surface-2)', color: 'var(--text-dim)',
                      fontSize: 11, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                    }}
                  >
                    <MessageSquare size={11} /> Chat
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── TASKS TAB ── */}
        {activeTab === 'tasks' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Tasks</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {(['inbox', 'in_progress', 'review', 'assigned', 'done', 'planning'] as TaskStatus[]).map(status => {
                const tasks = MOCK_TASKS.filter(t => t.status === status)
                return (
                  <div key={status} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <TaskBadge status={status} />
                      <span style={{ fontSize: 11, color: 'var(--text-dimmer)', marginLeft: 'auto' }}>{tasks.length}</span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {tasks.length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--text-dimmer)', textAlign: 'center', padding: '12px 0' }}>empty</div>
                      )}
                      {tasks.map(task => (
                        <div key={task.id} style={{
                          background: 'var(--surface-2)', border: '1px solid var(--border)',
                          borderRadius: 7, padding: '10px 12px',
                        }}>
                          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>{task.title}</div>
                          {task.agentId && (
                            <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>
                              → {MOCK_AGENTS.find(a => a.id === task.agentId)?.name}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── CHAT TAB ── */}
        {activeTab === 'chat' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out', height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700 }}>Chat</h1>
              <select
                value={chatAgent.id}
                onChange={e => setChatAgent(MOCK_AGENTS.find(a => a.id === e.target.value) || MOCK_AGENTS[0])}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6,
                  color: 'var(--text)', padding: '4px 10px', fontSize: 12, cursor: 'pointer',
                }}
              >
                {MOCK_AGENTS.map(a => <option key={a.id} value={a.id}>{a.name} ({a.model})</option>)}
              </select>
              <AgentStatusBadge status={chatAgent.status} />
            </div>

            {/* Messages */}
            <div className="card" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
              {chatHistory.map((msg, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{
                    maxWidth: '70%', padding: '10px 14px', borderRadius: 10, fontSize: 13,
                    background: msg.role === 'user' ? 'var(--accent)' : 'var(--surface-2)',
                    color: msg.role === 'user' ? '#fff' : 'var(--text)',
                    borderBottomRightRadius: msg.role === 'user' ? 2 : 10,
                    borderBottomLeftRadius: msg.role === 'assistant' ? 2 : 10,
                  }}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {isTyping && (
                <div style={{ display: 'flex', gap: 4, padding: '8px 0', alignItems: 'center' }}>
                  <Bot size={12} color="var(--text-dimmer)" />
                  <span style={{ fontSize: 11, color: 'var(--text-dimmer)', fontStyle: 'italic' }}>{chatAgent.name} is typing...</span>
                </div>
              )}
            </div>

            {/* Input */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={chatMessage}
                onChange={e => setChatMessage(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendChat()}
                placeholder={`Message ${chatAgent.name}...`}
                style={{
                  flex: 1, background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 8, padding: '10px 14px', color: 'var(--text)', fontSize: 13,
                  outline: 'none', fontFamily: 'DM Sans, sans-serif',
                }}
              />
              <button
                onClick={sendChat}
                style={{
                  padding: '10px 16px', background: 'var(--accent)', border: 'none',
                  borderRadius: 8, cursor: 'pointer', color: '#fff', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                <Send size={14} /> Send
              </button>
            </div>
          </div>
        )}

        {/* ── COSTS TAB ── */}
        {activeTab === 'costs' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Cost & Usage</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 20 }}>
              {[
                { label: "Today's Spend", value: `$${totalCost.toFixed(2)}`, color: 'var(--accent)' },
                { label: 'This Week', value: '$34.50', color: '#3b82f6' },
                { label: 'This Month', value: '$142.80', color: '#a855f7' },
              ].map(s => (
                <div key={s.label} className="card">
                  <div style={{ fontSize: 11, color: 'var(--text-dimmer)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 700, fontFamily: 'Syne, sans-serif', color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>

            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Spend per Agent</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {MOCK_AGENTS.map(agent => (
                  <div key={agent.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ width: 80, fontSize: 12, fontFamily: 'JetBrains Mono, monospace' }}>{agent.name}</span>
                    <div style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: 3, background: 'var(--accent)',
                        width: `${(agent.costUsd / totalCost) * 100}%`,
                        transition: 'width 0.5s ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 12, fontWeight: 600, width: 48, textAlign: 'right' }}>${agent.costUsd.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STACK TAB ── */}
        {activeTab === 'stack' && (
          <div style={{ animation: 'fadeIn 0.3s ease-out' }}>
            <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, marginBottom: 24 }}>Stack Health</h1>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              {MOCK_SERVICES.map(svc => (
                <div key={svc.name} className="card card-hover" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{
                    width: 44, height: 44, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: svc.status === 'healthy' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                  }}>
                    <Server size={20} color={svc.status === 'healthy' ? '#22c55e' : '#ef4444'} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{svc.name}</span>
                      <StatusDot status={svc.status} />
                    </div>
                    {svc.version && <div style={{ fontSize: 10, color: 'var(--text-dimmer)', fontFamily: 'JetBrains Mono, monospace' }}>v{svc.version}</div>}
                  </div>
                  {svc.latency && (
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: svc.latency < 10 ? 'var(--green)' : 'var(--yellow)' }}>{svc.latency}ms</div>
                      <div style={{ fontSize: 10, color: 'var(--text-dimmer)' }}>latency</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  )
}
