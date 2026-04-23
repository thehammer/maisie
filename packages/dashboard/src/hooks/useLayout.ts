import { useState, useCallback, useEffect } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export interface CardConfig {
  id: string;
  visible: boolean;
  col_span: 1 | 2;
  order: number;
  // ── Card configurator fields (optional — absent until user configures) ────
  title?: string;
  visibleFields?: string[];
  ops?: import("@maisie/shared").OpConfig[];
  rendererConfigs?: import("@maisie/shared").CardRendererConfig;
  sections?: import("@maisie/shared").SectionConfig[];
  displayStyle?: 'table' | 'card-list' | 'simple-list';
  /** Function fields to render as action buttons on the card. */
  functionFields?: Array<{ name: string; label?: string }>;
  /** Component name to use for rendering. If set, delegates to ComponentRenderer. */
  component?: string;
  /** Props passed to the component when `component` is set. */
  componentProps?: Record<string, unknown>;
  /**
   * View name to use for rendering. When set, the card resolves the named view
   * at render time — fetches the entity source, applies the function chain, and
   * delegates to ComponentRenderer with the view's component and componentProps.
   * Takes precedence over `component` when both are set.
   */
  view?: string;
}

interface LayoutState {
  widgets: CardConfig[];
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
  const [snapshot, setSnapshot] = useState<CardConfig[]>([]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        const res = await fetch(`/api/layout/${page}`);
        const widgets: CardConfig[] = res.ok ? await res.json() : [];
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

  const saveLayout = useCallback(async (currentWidgets: CardConfig[]) => {
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

  const addCard = useCallback((id: string, templateConfig?: Record<string, unknown>) => {
    setState((s) => {
      if (s.widgets.find((w) => w.id === id)) return s;
      const maxOrder = s.widgets.reduce((m, w) => Math.max(m, w.order), -1);
      const card: CardConfig = {
        id,
        visible: true,
        col_span: 1 as const,
        order: maxOrder + 1,
        ...(templateConfig as Partial<CardConfig>),
      };
      return { ...s, widgets: [...s.widgets, card] };
    });
  }, []);

  const removeCard = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      widgets: s.widgets.filter((w) => w.id !== id).map((w, i) => ({ ...w, order: i })),
    }));
  }, []);

  /** Update the configurator fields on a specific card and persist immediately. */
  const updateCardConfig = useCallback(
    async (id: string, patch: Pick<CardConfig, "title" | "visibleFields" | "ops" | "rendererConfigs" | "sections" | "component" | "componentProps">) => {
      const updated = state.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w));
      setState((s) => ({ ...s, widgets: updated }));
      // Persist immediately — config changes shouldn't require entering edit mode
      try {
        await fetch(`/api/layout/${page}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ widgets: updated }),
        });
        setSnapshot(updated);
      } catch {
        // Swallow — layout was applied locally regardless
      }
    },
    [page, state.widgets],
  );

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
    addCard,
    removeCard,
    updateCardConfig,
  };
}
