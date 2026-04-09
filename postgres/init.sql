-- clawstack postgres init
-- Runs once on first container start

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('active', 'idle', 'working', 'offline')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('planning', 'inbox', 'assigned', 'in_progress', 'review', 'done')),
  agent_id UUID REFERENCES agents(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID REFERENCES agents(id),
  prompt TEXT,
  response TEXT,
  tokens_in INT NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out INT NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  model TEXT,
  cost_usd NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  payload JSONB,
  agent_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at ON sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
