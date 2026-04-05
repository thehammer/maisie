import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardConfig } from "../hooks/useLayout";

interface Props {
  widget: CardConfig;
  isEditMode: boolean;
  onToggleVisible: () => void;
  onToggleColSpan: () => void;
  /** If provided, a remove button is shown — used for catalog-sourced widgets */
  onRemove?: () => void;
  children: React.ReactNode;
}

export function CardSlot({ widget, isEditMode, onToggleVisible, onToggleColSpan, onRemove, children }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: widget.id,
    disabled: !isEditMode,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    gridColumn: widget.col_span === 2 ? "1 / -1" : undefined,
    position: "relative",
  };

  // Hidden widgets are invisible in normal mode
  if (!widget.visible && !isEditMode) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={["card", !widget.visible ? "card-hidden" : ""].filter(Boolean).join(" ")}
    >
      {isEditMode && (
        <div className="card-edit-controls">
          <span className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
            ⠿
          </span>
          <button
            className="card-edit-btn"
            onClick={onToggleVisible}
            title={widget.visible ? "Hide card" : "Show card"}
          >
            {widget.visible ? "●" : "○"}
          </button>
          <button
            className="card-edit-btn"
            onClick={onToggleColSpan}
            title={widget.col_span === 2 ? "Make narrow" : "Make wide"}
          >
            {widget.col_span === 2 ? "⇥" : "⇔"}
          </button>
          {onRemove && (
            <button
              className="card-edit-btn"
              onClick={onRemove}
              title="Remove card"
              style={{ color: "var(--red, #f87171)" }}
            >
              ✕
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
