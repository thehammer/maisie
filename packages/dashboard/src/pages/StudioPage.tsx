import { useState, lazy, Suspense } from 'react'
import { Studio } from '../components/Studio'

const Canvas = lazy(() => import('../components/canvas/Canvas').then((m) => ({ default: m.Canvas })))

interface Props {
  onBack: () => void
}

type Tab = 'editor' | 'canvas'

export function StudioPage({ onBack }: Props) {
  const [tab, setTab] = useState<Tab>('editor')
  return (
    <div className="dashboard studio-page">
      <div className="dashboard-header">
        <button onClick={onBack} className="edit-layout-btn">&larr; Back</button>
        <h1>Studio</h1>
        <div className="studio-tabs">
          <button
            className={`studio-tab ${tab === 'editor' ? 'active' : ''}`}
            onClick={() => setTab('editor')}
          >
            Editor
          </button>
          <button
            className={`studio-tab ${tab === 'canvas' ? 'active' : ''}`}
            onClick={() => setTab('canvas')}
          >
            Canvas
          </button>
        </div>
      </div>
      {tab === 'editor' ? (
        <Studio />
      ) : (
        <Suspense fallback={<div className="studio-loading">Loading...</div>}>
          <Canvas />
        </Suspense>
      )}
    </div>
  )
}
