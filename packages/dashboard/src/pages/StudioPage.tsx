import { Studio } from '../components/Studio'

interface Props {
  onBack: () => void
}

export function StudioPage({ onBack }: Props) {
  return (
    <div className="dashboard studio-page">
      <div className="dashboard-header">
        <button onClick={onBack} className="edit-layout-btn">
          &larr; Back
        </button>
        <h1>Studio</h1>
      </div>
      <Studio />
    </div>
  )
}
