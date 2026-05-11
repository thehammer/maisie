import { z } from 'zod'
import { defineAction, field, zodToTypeExpr } from '@maisie/shared'

// ── Shared schemas ─────────────────────────────────────────────────────────────

const taskStatusEnum = z.enum(['todo', 'in_progress', 'done', 'blocked'])

const taskSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: field(taskStatusEnum, 'status'),
  assignee: z.string().nullable(),
  dueDate: field(z.string().nullable(), 'timestamp'),
  createdAt: field(z.string(), 'timestamp'),
  priority: z.enum(['low', 'medium', 'high']),
})

// Verify zodToTypeExpr works on our output schemas at module load time.
// This is the proof that the type system can express this domain.
export const _taskTypeExpr = zodToTypeExpr(taskSchema)
export const _taskListTypeExpr = zodToTypeExpr(z.array(taskSchema))

// ── In-memory stub store ────────────────────────────────────────────────────────

const STUB_TASKS = [
  { id: 'T-001', title: 'Implement login page', status: 'done' as const,
    assignee: 'alice', dueDate: '2026-04-01T00:00:00Z',
    createdAt: '2026-03-01T10:00:00Z', priority: 'high' as const },
  { id: 'T-002', title: 'Write API docs', status: 'in_progress' as const,
    assignee: 'bob', dueDate: '2026-05-15T00:00:00Z',
    createdAt: '2026-03-15T09:00:00Z', priority: 'medium' as const },
  { id: 'T-003', title: 'Fix auth bug', status: 'todo' as const,
    assignee: null, dueDate: null,
    createdAt: '2026-04-20T14:00:00Z', priority: 'high' as const },
]

// ── Actions ────────────────────────────────────────────────────────────────────

export const listTasks = defineAction({
  name: 'list_tasks',
  description: 'List all tasks in the project tracker.',
  input: z.object({
    status: taskStatusEnum.optional(),
    limit: z.number().default(20),
  }),
  output: z.array(taskSchema),
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Task List', section: 'dev' },
  async execute(input) {
    let tasks = STUB_TASKS
    if (input.status) tasks = tasks.filter(t => t.status === input.status)
    return tasks.slice(0, input.limit)
  },
})

export const getTask = defineAction({
  name: 'get_task',
  description: 'Get a single task by ID.',
  input: z.object({ id: z.string() }),
  output: taskSchema,
  http: { method: 'GET' },
  ai: { tier: 'inform' },
  ui: { type: 'data', label: 'Task Detail', section: 'dev' },
  async execute(input) {
    const task = STUB_TASKS.find(t => t.id === input.id)
    if (!task) throw new Error(`Task not found: ${input.id}`)
    return task
  },
})

export const createTask = defineAction({
  name: 'invoke_create_task',
  description: 'Create a new task in the project tracker.',
  input: z.object({
    title: z.string(),
    assignee: z.string().optional(),
    priority: z.enum(['low', 'medium', 'high']).default('medium'),
  }),
  output: taskSchema,
  http: { method: 'POST' },
  ai: { tier: 'act', description: 'Creates a new task. Use when user asks to track new work.' },
  ui: { type: 'action', label: 'Create Task', section: 'dev' },
  async execute(input) {
    return {
      id: `T-${String(Date.now()).slice(-4)}`,
      title: input.title,
      status: 'todo' as const,
      assignee: input.assignee ?? null,
      dueDate: null,
      createdAt: new Date().toISOString(),
      priority: input.priority,
    }
  },
})

export const updateTaskStatus = defineAction({
  name: 'invoke_update_task_status',
  description: 'Update the status of an existing task.',
  input: z.object({
    id: z.string(),
    status: taskStatusEnum,
  }),
  output: taskSchema,
  http: { method: 'PATCH' },
  ai: { tier: 'advise', description: 'Updates task status. Requires confirmation before changing to done.' },
  ui: { type: 'action', label: 'Update Status', section: 'dev' },
  async execute(input) {
    const task = STUB_TASKS.find(t => t.id === input.id)
    if (!task) throw new Error(`Task not found: ${input.id}`)
    return { ...task, status: input.status }
  },
})
