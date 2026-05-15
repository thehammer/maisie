import type { Scope } from './scope'

export interface Success<T> {
  ok: true
  data: T
  scope_applied: Scope
  generated_at: string
}

export interface NotFound {
  ok: false
  kind: 'not_found'
  suggestions?: string[]
}

export interface ErrorResult {
  ok: false
  kind: 'error'
  code: string
  message: string
  retriable: boolean
}

export type ToolResult<T> = Success<T> | NotFound | ErrorResult
