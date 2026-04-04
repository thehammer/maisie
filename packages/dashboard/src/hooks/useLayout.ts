import { useState, useCallback, useEffect } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export interface WidgetConfig {
  id: string;
  visible: boolean;
  col_span: 1 | 2;
  order: number;
}

interface LayoutState {
  widgets: WidgetConfig[];
  isEditMode: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export function useLayout(page: string) {
  const [state, setState] = useState<LayoutState>({
    widgets: [],
    isEditMode: false,
    loading: true,
    saving: false,
    error: null,
  });
  // Snapshot for cancel — captured when entering edit mode
  const [snapshot, setSnapshot] = useState<WidgetConfig[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch(`/api/layout/${page}`);
        const widgets: WidgetConfig[] = res.ok ? await res.json() : [];
        if (mounted) {
          const sorted = [...widgets].sort((a, b) => a.order - b.order);
          setState((s) => ({ ...s, widgets: sorted, loading: false }));
          setSnapshot(sorted);
        }
      } catch (err) {
        if (mounted) setState((s) => ({ ...s, loading: false, error: String(err) }));
      }
    }

    load();
    return () => { mounted = false; };
  }, [page]);

  const enterEditMode = useCallback(() => {
    setState((s) => {
      setSnapshot(s.widgets);
      return { ...s, isEditMode: true };
    });
  }, []);

  const cancelEditMode = useCallback(() => {
    setState((s) => ({ ...s, isEditMode: false, widgets: snapshot }));
  }, [snapshot]);

  const saveLayout = useCallback(async (currentWidgets: WidgetConfig[]) => {
    setState((s) => ({ ...s, saving: true, error: null }));
    try {
      const res = await fetch(`/api/layout/${page}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgets: currentWidgets }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      setSnapshot(currentWidgets);
      setState((s) => ({ ...s, saving: false, isEditMode: false }));
    } catch (err) {
      setState((s) => ({ ...s, saving: false, error: String(err) }));
    }
  }, [page]);

  const setVisible = useCallback((id: string, visible: boolean) => {
    setState((s) => ({
      ...s,
      widgets: s.widgets.map((w) => (w.id === id ? { ...w, visible } : w)),
    }));
  }, []);

  const setColSpan = useCallback((id: string, col_span: 1 | 2) => {
    setState((s) => ({
      ...s,
      widgets: s.widgets.map((w) => (w.id === id ? { ...w, col_span } : w)),
    }));
  }, []);

  // Called by DraggableDashboardGrid after a drag ends
  const reorder = useCallback((activeId: string, overId: string) => {
    setState((s) => {
      const oldIndex = s.widgets.findIndex((w) => w.id === activeId);
      const newIndex = s.widgets.findIndex((w) => w.id === overId);
      if (oldIndex === -1 || newIndex === -1) return s;
      const moved = arrayMove(s.widgets, oldIndex, newIndex).map((w, i) => ({
        ...w,
        order: i,
      }));
      return { ...s, widgets: moved };
    });
  }, []);

  return {
    widgets: state.widgets,
    isEditMode: state.isEditMode,
    loading: state.loading,
    saving: state.saving,
    error: state.error,
    enterEditMode,
    cancelEditMode,
    saveLayout: () => saveLayout(state.widgets),
    setVisible,
    setColSpan,
    reorder,
  };
}
