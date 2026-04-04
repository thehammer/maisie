import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { WidgetConfig } from "../hooks/useLayout";

interface Props {
  widget: WidgetConfig;
  isEditMode: boolean;
  onToggleVisible: () => void;
  onToggleColSpan: () => void;
  children: React.ReactNode;
}

export function WidgetSlot({ widget, isEditMode, onToggleVisible, onToggleColSpan, children }: Props) {
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
      className={["card", !widget.visible ? "widget-hidden" : ""].filter(Boolean).join(" ")}
    >
      {isEditMode && (
        <div className="widget-edit-controls">
          <span className="drag-handle" {...attributes} {...listeners} title="Drag to reorder">
            ⠿
          </span>
          <button
            className="widget-edit-btn"
            onClick={onToggleVisible}
            title={widget.visible ? "Hide widget" : "Show widget"}
          >
            {widget.visible ? "●" : "○"}
          </button>
          <button
            className="widget-edit-btn"
            onClick={onToggleColSpan}
            title={widget.col_span === 2 ? "Make narrow" : "Make wide"}
          >
            {widget.col_span === 2 ? "⇥" : "⇔"}
          </button>
        </div>
      )}
      {children}
    </div>
  );
}
