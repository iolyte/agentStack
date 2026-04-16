import assert from 'node:assert/strict'
import test from 'node:test'
import { __testing as workspaceTesting } from '@/lib/workspace'

test('planner payload parsing accepts fenced json', () => {
  const payload = workspaceTesting.extractPlannerPayload(`
\`\`\`json
{
  "projectSummary": "Launch the first ClawStack workspace.",
  "tasks": [
    {
      "title": "Research the implementation surface",
      "description": "Map the first milestone and validate the stack seams.",
      "priority": "high",
      "assignedDepartment": "research"
    }
  ]
}
\`\`\`
`)

  assert.equal(payload?.projectSummary, 'Launch the first ClawStack workspace.')
  assert.equal(payload?.tasks.length, 1)
  assert.equal(payload?.tasks[0]?.assignedDepartment, 'research')
})

test('planner payload parsing rejects non-json replies', () => {
  const payload = workspaceTesting.extractPlannerPayload('Here is a loose answer without structured JSON.')

  assert.equal(payload, null)
})

test('canonical session keys are agent scoped', () => {
  assert.equal(workspaceTesting.getCanonicalSessionKey('core'), 'agent:core:main')
})
