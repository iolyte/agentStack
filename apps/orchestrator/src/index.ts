import { createServer } from 'node:http'
import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { createClient } from 'redis'

const PORT = Number.parseInt(process.env.ORCHESTRATOR_PORT?.trim() || '4200', 10)
const REDIS_URL = process.env.REDIS_URL?.trim() || 'redis://redis:6379'
const RUN_REQUESTS_STREAM = 'clawstack:run-requests'

const RunEventState = Annotation.Root({
  streamId: Annotation<string>(),
  runId: Annotation<string>(),
  workspaceId: Annotation<string>(),
  agentId: Annotation<string>(),
  receivedAt: Annotation<string>(),
})

const graph = new StateGraph(RunEventState)
  .addNode('normalize', async (state) => ({
    ...state,
    receivedAt: state.receivedAt || new Date().toISOString(),
  }))
  .addEdge(START, 'normalize')
  .addEdge('normalize', END)
  .compile()

async function startWorker() {
  const client = createClient({ url: REDIS_URL })
  await client.connect()

  let lastId = '$'

  while (true) {
    const response = (await client.xRead(
      [{ key: RUN_REQUESTS_STREAM, id: lastId }],
      {
        BLOCK: 5000,
        COUNT: 10,
      },
    )) as Array<{ name: string; messages: Array<{ id: string; message: Record<string, string> }> }> | null

    for (const stream of response ?? []) {
      for (const message of stream.messages) {
        lastId = message.id
        await graph.invoke({
          streamId: message.id,
          runId: String(message.message.runId ?? ''),
          workspaceId: String(message.message.workspaceId ?? ''),
          agentId: String(message.message.agentId ?? ''),
          receivedAt: new Date().toISOString(),
        })
      }
    }
  }
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify({ ok: true, service: 'orchestrator' }))
})

server.listen(PORT, '0.0.0.0')

void startWorker().catch((error) => {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'orchestrator',
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }),
  )
  process.exit(1)
})
