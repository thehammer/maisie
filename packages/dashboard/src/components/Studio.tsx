/**
 * EntityEditor — CodeMirror 6-based editor for MEL expressions and entity definitions.
 *
 * Split layout: editor left, live result panel right.
 * Toolbar: Run (evaluates MEL), Save (saves as derived entity), Load example.
 */

import { useEffect, useRef, useState } from 'react'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { defaultKeymap, historyKeymap, history } from '@codemirror/commands'
import { bracketMatching } from '@codemirror/language'
import { autocompletion } from '@codemirror/autocomplete'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { mel } from '../lib/editor/mel-stream-language'
import { melCompletions, refreshCompletionCatalog } from '../lib/editor/mel-completion'
import { melLinter } from '../lib/editor/mel-linter'
import { parse } from '@maisie/shared'
import { refreshComponents } from '../lib/components/resolver'

const API = import.meta.env.VITE_API_URL || ''

const STARTER_SOURCE = `# MEL — Maisie Expression Language.
# This is a complete entity. Click Run to preview each field's value,
# or Save to register it in the catalog.

define system-entities {
  description: "All entities in the system section of the catalog."

  items: collection =
    catalog.items | filter: (e) => e.section == "system"

  names: collection =
    self.items | pluck: name

  total: number =
    self.items | count
}
`

const STARTER_ENTITY = `define exterior-lights {
  description: "Exterior light switches"

  switches: collection =
    home-assistant.list_switches | filter: (sw) => sw.name contains "exterior"
}
`

interface EvalResult {
  value?: unknown
  type?: string
  error?: string
}

export function Studio() {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [result, setResult] = useState<EvalResult | null>(null)
  const [running, setRunning] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!editorRef.current) return

    const startState = EditorState.create({
      doc: STARTER_SOURCE,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        oneDark,
        mel(),
        autocompletion({ override: [melCompletions] }),
        lintGutter(),
        linter(melLinter, { delay: 500 }),
      ],
    })

    const view = new EditorView({
      state: startState,
      parent: editorRef.current,
    })
    viewRef.current = view

    return () => view.destroy()
  }, [])

  const getSource = () => viewRef.current?.state.doc.toString() ?? ''

  const handleRun = async () => {
    setRunning(true)
    setResult(null)
    setSaveStatus(null)
    try {
      const res = await fetch(`${API}/api/eval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: getSource() }),
      })
      const data = await res.json() as EvalResult
      setResult(data)
    } catch (err) {
      setResult({ error: String(err) })
    } finally {
      setRunning(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus(null)
    const source = getSource()

    // Detect entity vs component from the source by parsing it. Source that
    // defines a component (has a render: field) goes to /api/components;
    // entities go to /api/entities. Parse errors surface as save errors.
    let endpoint = `${API}/api/entities`
    let kindLabel = 'entity'
    try {
      const parsed = parse(source)
      if (parsed && typeof parsed === 'object' && 'kind' in parsed) {
        if (parsed.kind === 'component') {
          endpoint = `${API}/api/components`
          kindLabel = 'component'
        } else if (parsed.kind === 'entity') {
          endpoint = `${API}/api/entities`
          kindLabel = 'entity'
        } else {
          setSaveStatus('Error: source is an expression, not a define block — write `define Name { ... }` to save')
          setSaving(false)
          return
        }
      }
    } catch (err) {
      setSaveStatus(`Parse error: ${err instanceof Error ? err.message : String(err)}`)
      setSaving(false)
      return
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source }),
      })
      const data = await res.json() as { name?: string; error?: string }
      if (res.ok) {
        setSaveStatus(`Saved ${kindLabel}: ${data.name}`)
        refreshCompletionCatalog()
        if (kindLabel === 'component') refreshComponents()
      } else {
        setSaveStatus(`Error: ${data.error ?? 'unknown'}`)
      }
    } catch (err) {
      setSaveStatus(`Error: ${String(err)}`)
    } finally {
      setSaving(false)
    }
  }

  const loadStarterEntity = () => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      changes: {
        from: 0,
        to: viewRef.current.state.doc.length,
        insert: STARTER_ENTITY,
      },
    })
    setResult(null)
    setSaveStatus(null)
  }

  return (
    <div className="entity-editor">
      <div className="entity-editor-header">
        <h2>Studio</h2>
        <div className="entity-editor-actions">
          <button onClick={loadStarterEntity} className="edit-layout-btn">
            Load example
          </button>
          <button onClick={handleRun} className="edit-layout-btn" disabled={running}>
            {running ? 'Running...' : '> Run'}
          </button>
          <button onClick={handleSave} className="edit-layout-btn entity-editor-save-btn" disabled={saving}>
            {saving ? 'Saving...' : 'Save Entity'}
          </button>
          {saveStatus && (
            <span className="entity-editor-status">{saveStatus}</span>
          )}
        </div>
      </div>
      <div className="entity-editor-split">
        <div ref={editorRef} className="entity-editor-source" />
        <div className="entity-editor-preview">
          {result === null && (
            <div className="empty-state">Click Run to evaluate</div>
          )}
          {result?.error && (
            <div className="resource-error">{result.error}</div>
          )}
          {result !== null && result.value !== undefined && (
            <div className="entity-editor-result">
              <div className="entity-editor-result-meta">
                Type: <code>{result.type ?? 'unknown'}</code>
              </div>
              <pre className="resource-json">
                {JSON.stringify(result.value, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
