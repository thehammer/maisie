/**
 * CodeMirror 6 linter for MEL (Maisie Expression Language).
 *
 * On every (debounced) change, sends source to POST /api/eval/validate and
 * marks parse errors inline with an underline + hover tooltip.
 */

import type { Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'

interface ValidateError {
  line: number
  col: number
  message: string
}

interface ValidateResponse {
  valid: boolean
  errors?: ValidateError[]
}

export async function melLinter(view: EditorView): Promise<Diagnostic[]> {
  const source = view.state.doc.toString()
  if (source.trim().length === 0) return []

  let data: ValidateResponse
  try {
    const res = await fetch('/api/eval/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source }),
    })
    data = await res.json() as ValidateResponse
  } catch {
    // Network error or endpoint not available — fail silently
    return []
  }

  if (data.valid) return []

  return (data.errors ?? []).map((e) => {
    // Convert 1-based line/col to absolute document offset.
    // line=0 means "unknown position" — anchor at start of document.
    const line = Math.max(1, e.line ?? 1)
    const col = Math.max(1, e.col ?? 1)

    let offset = 0
    if (line === 1 && col === 1) {
      // Unknown or first position — mark first token
      offset = 0
    } else {
      let currentLine = 1
      for (let i = 0; i < source.length; i++) {
        if (currentLine === line) {
          offset = i + col - 1
          break
        }
        if (source[i] === '\n') currentLine++
      }
    }
    offset = Math.min(Math.max(0, offset), Math.max(0, source.length - 1))

    return {
      from: offset,
      to: Math.min(offset + 1, source.length),
      severity: 'error' as const,
      message: e.message,
    }
  })
}
