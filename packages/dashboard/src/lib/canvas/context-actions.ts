import type { Placement, Wire } from './document'
import type { MenuItem } from '../../components/canvas/ContextMenu'

export interface CanvasContextHandlers {
  removePlacement: (id: string) => void
  removeWire: (id: string) => void
  duplicatePlacement: (id: string) => void
  resetPlacementConfig: (id: string) => void
  openTransformEditor: (wireId: string) => void
  suggestChains: (wireId: string) => void
  addFromPalette: (kind: 'entity' | 'component' | 'function', targetName: string) => void
  openInStudio: (kind: 'entity' | 'component', name: string) => void
  copyToClipboard: (text: string) => void
  clearCanvas: () => void
  openSaveAs: (kind: 'component' | 'entity' | 'view') => void
}

export function placementMenu(placement: Placement, handlers: CanvasContextHandlers): MenuItem[] {
  const items: MenuItem[] = [
    { id: 'duplicate', label: 'Duplicate', onSelect: () => handlers.duplicatePlacement(placement.id) },
    { id: 'copy-name', label: 'Copy name', onSelect: () => handlers.copyToClipboard(placement.targetName) },
  ]
  if (placement.kind === 'function') {
    items.push({
      id: 'reset-params',
      label: 'Reset parameters',
      onSelect: () => handlers.resetPlacementConfig(placement.id),
      disabled: !placement.config || Object.keys(placement.config).length === 0,
    })
  }
  if (placement.kind === 'entity' || placement.kind === 'component') {
    items.push({
      id: 'open-studio',
      label: 'Open in Studio editor',
      onSelect: () => handlers.openInStudio(placement.kind as 'entity' | 'component', placement.targetName),
    })
  }
  items.push({ id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.removePlacement(placement.id) })
  return items
}

export function wireMenu(wire: Wire, handlers: CanvasContextHandlers, hasChainSuggestions: boolean): MenuItem[] {
  return [
    { id: 'transform', label: wire.transform ? 'Edit transform' : 'Add transform', onSelect: () => handlers.openTransformEditor(wire.id) },
    { id: 'suggest', label: 'Suggest chains', disabled: !hasChainSuggestions, onSelect: () => handlers.suggestChains(wire.id) },
    { id: 'delete', label: 'Delete', danger: true, onSelect: () => handlers.removeWire(wire.id) },
  ]
}

export function surfaceMenu(handlers: CanvasContextHandlers): MenuItem[] {
  return [
    { id: 'save-component', label: 'Save as Component...', onSelect: () => handlers.openSaveAs('component') },
    { id: 'save-entity', label: 'Save as Entity...', onSelect: () => handlers.openSaveAs('entity') },
    { id: 'save-view', label: 'Save as View...', onSelect: () => handlers.openSaveAs('view') },
    { id: 'clear', label: 'Clear canvas', danger: true, onSelect: () => handlers.clearCanvas() },
  ]
}

export function paletteItemMenu(
  kind: 'entity' | 'component' | 'function',
  name: string,
  handlers: CanvasContextHandlers,
): MenuItem[] {
  const items: MenuItem[] = [
    { id: 'add', label: 'Add to canvas', onSelect: () => handlers.addFromPalette(kind, name) },
    { id: 'copy-address', label: 'Copy address', onSelect: () => handlers.copyToClipboard(name) },
  ]
  if (kind === 'entity' || kind === 'component') {
    items.push({
      id: 'open-studio',
      label: 'Open in Studio editor',
      onSelect: () => handlers.openInStudio(kind, name),
    })
  }
  return items
}
