import { formatType } from '@maisie/shared'
import type { BridgingChain } from '../../lib/canvas/chain-search'

interface Props {
  chains: BridgingChain[]
  onApply: (chain: BridgingChain) => void
  onDismiss: () => void
  /** Canvas-relative position to anchor the popover near. */
  anchorPos?: { x: number; y: number }
}

export function ChainSuggestionPopover({ chains, onApply, onDismiss, anchorPos }: Props) {
  if (chains.length === 0) return null

  const style: React.CSSProperties = anchorPos
    ? { left: anchorPos.x, top: anchorPos.y }
    : {}

  return (
    <div className="chain-suggestion-popover" style={style}>
      <div className="chain-suggestion-header">
        <span className="chain-suggestion-title">Suggested bridges</span>
        <button className="chain-suggestion-dismiss" onClick={onDismiss} title="Dismiss">
          &times;
        </button>
      </div>
      <div className="chain-suggestion-desc">
        These function chains bridge the incompatible types. Click Apply to insert them.
      </div>
      <ul className="chain-suggestion-list">
        {chains.slice(0, 5).map((chain, i) => (
          <ChainOption key={i} chain={chain} onApply={onApply} />
        ))}
      </ul>
    </div>
  )
}

interface ChainOptionProps {
  chain: BridgingChain
  onApply: (chain: BridgingChain) => void
}

function ChainOption({ chain, onApply }: ChainOptionProps) {
  return (
    <li className="chain-suggestion-item">
      <div className="chain-suggestion-chain">
        {chain.steps.map((step, i) => (
          <span key={step.functionId + i} className="chain-suggestion-step-group">
            <span className="chain-suggestion-step">{step.descriptor.name}</span>
            {i < chain.steps.length - 1 && (
              <span className="chain-suggestion-arrow">→</span>
            )}
          </span>
        ))}
        <span className="chain-suggestion-output-type">
          → {formatType(chain.outputType)}
        </span>
      </div>
      <button
        className="chain-suggestion-apply"
        onClick={() => onApply(chain)}
      >
        Apply
      </button>
    </li>
  )
}
