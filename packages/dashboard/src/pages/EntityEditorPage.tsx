import { EntityEditor } from '../components/EntityEditor'

interface Props {
  onBack: () => void
}

export function EntityEditorPage({ onBack }: Props) {
  return (
    <div className="dashboard entity-editor-page">
      <div className="dashboard-header">
        <button onClick={onBack} className="edit-layout-btn">
          &larr; Back
        </button>
        <h1>Entity Editor</h1>
      </div>
      <EntityEditor />
    </div>
  )
}
