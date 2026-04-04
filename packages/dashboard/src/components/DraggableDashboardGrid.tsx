import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import type { WidgetConfig } from "../hooks/useLayout";

interface Props {
  widgets: WidgetConfig[];
  isEditMode: boolean;
  onReorder: (activeId: string, overId: string) => void;
  children: React.ReactNode;
}

export function DraggableDashboardGrid({ widgets, isEditMode, onReorder, children }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  }

  const ids = widgets.map((w) => w.id);

  if (!isEditMode) {
    return <div className="grid">{children}</div>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className="grid edit-mode">{children}</div>
      </SortableContext>
    </DndContext>
  );
}
