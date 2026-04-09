type LogLevel = 'info' | 'warn' | 'error'

function write(level: LogLevel, message: string, meta?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    ...(meta ? { meta } : {}),
    timestamp: new Date().toISOString(),
  }

  if (level === 'error') {
    console.error(JSON.stringify(payload))
    return
  }

  if (level === 'warn') {
    console.warn(JSON.stringify(payload))
    return
  }

  console.info(JSON.stringify(payload))
}

export const logger = {
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
}
